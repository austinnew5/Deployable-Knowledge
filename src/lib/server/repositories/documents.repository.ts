import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	inArray,
	notExists,
	or,
	sql,
	type Column,
	type SQL
} from 'drizzle-orm';
import type {
	ApiDocumentListQuery,
	ApiDocumentListResponse,
	ApiTranscriptResponse,
	DocumentRow
} from '$lib/types';
import { db } from '$lib/server/database/database';
import {
	documentChunks,
	documentTags,
	documents,
	syncedFiles,
	syncedFolders,
	tags
} from '$lib/server/database/schema';

function likePattern(token: string): string {
	return `%${token.replace(/[\\%_]/g, '\\$&')}%`;
}

function likeContains(column: Column, token: string): SQL {
	return sql`${column} LIKE ${likePattern(token)} ESCAPE '\\'`;
}

function hasTagIn(values: string[]): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(documentTags)
			.where(and(eq(documentTags.documentId, documents.id), inArray(documentTags.tag, values)))
	);
}

function hasTagLike(token: string): SQL {
	return exists(
		db
			.select({ one: sql`1` })
			.from(documentTags)
			.where(and(eq(documentTags.documentId, documents.id), likeContains(documentTags.tag, token)))
	);
}

function listConditions({ mode, query, tags: tagFilter }: ApiDocumentListQuery): SQL | undefined {
	const conditions: SQL[] = [];
	if (mode === 'active') conditions.push(eq(documents.active, true));
	if (mode === 'inactive') conditions.push(eq(documents.active, false));
	if (tagFilter?.length) conditions.push(hasTagIn(tagFilter));
	for (const token of query?.trim().split(/\s+/).filter(Boolean) ?? []) {
		conditions.push(or(likeContains(documents.title, token), hasTagLike(token))!);
	}
	return conditions.length ? and(...conditions) : undefined;
}

export class DocumentsRepository {
	static async list(): Promise<ApiDocumentListResponse> {
		// createdAt is needed for the Newest/Oldest sort options, wasn't
		// being selected here before
		const rows = await db
			.select({ id: documents.id })
			.from(documents)
			.where(conditions.length ? and(...conditions) : undefined);
		return rows.map(({ id }) => id);
	}

	static async list(options: ApiDocumentListQuery = {}): Promise<ApiDocumentListResponse> {
		const where = listConditions(options);
		// most/least-chunks need the chunk count in the ORDER BY itself (not just
		// looked up afterward for display), so the join+groupBy always runs and
		// the other sort modes just ignore the extra column
		const chunkCountExpr = count(documentChunks.id);
		const orderBy = ((): SQL[] => {
			switch (options.sort) {
				case 'title-desc':
					return [desc(sql`${documents.title} COLLATE NOCASE`)];
				case 'newest':
					return [desc(documents.createdAt)];
				case 'oldest':
					return [asc(documents.createdAt)];
				case 'most-chunks':
					return [desc(chunkCountExpr)];
				case 'least-chunks':
					return [asc(chunkCountExpr)];
				default:
					return [asc(sql`${documents.title} COLLATE NOCASE`)];
			}
		})();

		const page = db
			.select({
				id: documents.id,
				title: documents.title,
				sourcePath: documents.sourcePath,
				sourceType: documents.sourceType,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				active: documents.active,
				chunkCount: chunkCountExpr
			})
			.from(documents)
			.leftJoin(documentChunks, eq(documentChunks.documentId, documents.id))
			.where(where)
			.groupBy(documents.id)
			.orderBy(...orderBy, asc(documents.id));

		const [rows, [{ total }], availableTags, folderCounts] = await Promise.all([
			options.limit === undefined ? page : page.limit(options.limit).offset(options.offset ?? 0),
			db.select({ total: count() }).from(documents).where(where),
			db.select({ name: tags.name }).from(tags).orderBy(asc(tags.name)),
			db
				.select({ folderId: syncedFiles.folderId, total: count() })
				.from(documents)
				.leftJoin(syncedFiles, eq(syncedFiles.documentId, documents.id))
				.where(where)
				.groupBy(syncedFiles.folderId)
		]);

		const documentIds = rows.map(({ id }) => id);
		const [tagRows, folderRows] = documentIds.length
			? await Promise.all([
					db
						.select({ documentId: documentTags.documentId, tag: documentTags.tag })
						.from(documentTags)
						.where(inArray(documentTags.documentId, documentIds))
						.orderBy(asc(documentTags.tag)),
					db
						.select({ documentId: syncedFiles.documentId, folderId: syncedFiles.folderId })
						.from(syncedFiles)
						.where(inArray(syncedFiles.documentId, documentIds))
				])
			: [[], []];

		const tagsByDocument = new Map<string, string[]>();

		for (const row of tagRows) {
			const values = tagsByDocument.get(row.documentId) ?? [];
			values.push(row.tag);
			tagsByDocument.set(row.documentId, values);
		}

		const folderByDocument = new Map(folderRows.map((row) => [row.documentId, row.folderId]));

		const documentRows: DocumentRow[] = rows.map((row) => ({
			...row,
			folderId: folderByDocument.get(row.id) ?? null,
			tags: tagsByDocument.get(row.id) ?? []
		}));
		return {
			documents: documentRows,
			folderCounts,
			tags: availableTags.map(({ name }) => name),
			total
		};
	}

	static async transcript(documentId: string): Promise<ApiTranscriptResponse | null> {
		const [document] = await db
			.select({
				id: documents.id,
				title: documents.title,
				sourceType: documents.sourceType,
				updatedAt: documents.updatedAt
			})
			.from(documents)
			.where(eq(documents.id, documentId))
			.limit(1);

		if (!document) return null;

		const chunks = await db
			.select({
				id: documentChunks.id,
				chunkIndex: documentChunks.chunkIndex,
				content: documentChunks.content,
				startMs: documentChunks.startMs,
				endMs: documentChunks.endMs
			})
			.from(documentChunks)
			.where(eq(documentChunks.documentId, documentId))
			.orderBy(asc(documentChunks.chunkIndex));

		return { chunks, document };
	}
}
