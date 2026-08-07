import { API_SETUP } from '$lib/constants';
import type {
	ApiSearchSetupEvent,
	ApiSearchSetupStage,
	ApiSearchSetupStatus,
	ApiDocumentIngestProgress
} from '$lib/types';
import { apiFetch, apiStream, formatBytes, parseNdjsonStream } from '$lib/utils';

const STAGE_LABELS: Record<ApiSearchSetupStage, string> = {
	embedding: 'Installing embedding model',
	rerank: 'Installing reranking model'
};

export class SetupService {
	static getStatus() {
		return apiFetch<ApiSearchSetupStatus>(API_SETUP);
	}

	static async install(
		onProgress?: (progress: ApiDocumentIngestProgress) => void,
		signal?: AbortSignal
	): Promise<void> {
		const response = await apiStream(API_SETUP, { method: 'POST', signal });
		for await (const event of parseNdjsonStream<ApiSearchSetupEvent>(response, signal)) {
			if (event.status === 'progress') {
				onProgress?.({
					percent: event.progress,
					label: STAGE_LABELS[event.stage],
					message: `${formatBytes(event.loaded)} / ${formatBytes(event.total)}`
				});
			} else if (event.status === 'error') {
				throw new Error(event.message);
			}
		}
	}
}
