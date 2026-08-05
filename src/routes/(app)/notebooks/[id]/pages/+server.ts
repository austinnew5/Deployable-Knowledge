import { json, type RequestHandler } from "@sveltejs/kit";
import { randomUUID } from "node:crypto";
import { eq, max } from "drizzle-orm";
import type { NotebookPageTitleRequest } from "$lib/requestTypes";
import type { ApiReorderResponse } from "$lib/types";
import { db } from "$lib/server/database/database";
import { notebooks, notebook_pages, type NewNotebookPage } from "$lib/server/database/schema";
import { parseReorderRequest } from "$lib/server/notebooks/notebook-order";
import {
  loadNotebookState,
  NotebooksRepository,
  setActiveNotebook,
} from "$lib/server/repositories/notebooks.repository";

export const POST: RequestHandler = async ({ params, request }) => {
  const notebookId = params.id;
  if (!notebookId) return json({ error: "Missing notebook id" }, { status: 400 });
  const body = (await request.json()) as NotebookPageTitleRequest;
  const title = body.title.trim();
  if (!title) {
    return json({ error: "Page title is required" }, { status: 400 });
  }

  const [notebook] = await db
    .select({ id: notebooks.id })
    .from(notebooks)
    .where(eq(notebooks.id, notebookId))
    .limit(1);
  if (!notebook) return json({ message: "Notebook not found." }, { status: 404 });

  const existingPages = await db
    .select({ title: notebook_pages.title })
    .from(notebook_pages)
    .where(eq(notebook_pages.notebookId, notebookId));
  if (existingPages.some((page) => page.title.trim().toLocaleLowerCase() === title.toLocaleLowerCase())) {
    return json({ message: `A page named “${title}” already exists in this notebook.` }, { status: 409 });
  }

  const timestamp = new Date().toISOString();
  const pageId = randomUUID();
  const [result] = await db
    .select({ maximum: max(notebook_pages.sortOrder) })
    .from(notebook_pages)
    .where(eq(notebook_pages.notebookId, notebookId));

  const page: NewNotebookPage = {
    id: pageId,
    notebookId,
    title,
    content: "",
    sortOrder: (result?.maximum ?? -1) + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await db.insert(notebook_pages).values(page);
  await db
    .update(notebooks)
    .set({ activePageId: pageId, updatedAt: timestamp })
    .where(eq(notebooks.id, notebookId));
  await setActiveNotebook(notebookId);

  return json({
    ...(await loadNotebookState()),
    createdPageId: pageId,
  }, { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
	const notebookId = params.id;
	if (!notebookId) return json({ error: 'Missing notebook id' }, { status: 400 });

	const body = parseReorderRequest(await request.json().catch(() => null));
	if (!body) return json({ error: 'Invalid page order' }, { status: 400 });

	if (!(await NotebooksRepository.reorderPages(notebookId, body.orderedIds))) {
		return json({ error: 'Page order is out of date' }, { status: 409 });
	}

	return json({ ok: true } satisfies ApiReorderResponse);
};
