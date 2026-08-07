import { json } from '@sveltejs/kit';
import type { ApiSearchSetupEvent, ApiSearchSetupStage } from '$lib/types';
import { installEmbeddingModel, isEmbeddingModelInstalled } from '$lib/server/rag/embedding-model';
import { installRerankModel, isRerankModelInstalled } from '$lib/server/rag/search/cross-rerank';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const [embeddingInstalled, rerankInstalled] = await Promise.all([
		isEmbeddingModelInstalled(),
		isRerankModelInstalled()
	]);

	return json({ installed: embeddingInstalled && rerankInstalled });
};

export const POST: RequestHandler = async () => {
	const encoder = new TextEncoder();
	let connected = true;

	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: ApiSearchSetupEvent) => {
				if (!connected) return;

				try {
					controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
				} catch {
					connected = false;
				}
			};

			let currentStage: ApiSearchSetupStage = 'embedding';

			const installStage = async (
				stage: ApiSearchSetupStage,
				isInstalled: () => Promise<boolean>,
				install: (
					onProgress: (progress: number, loaded: number, total: number) => void
				) => Promise<unknown>
			) => {
				currentStage = stage;
				if (await isInstalled()) return;

				await install((progress, loaded, total) => {
					send({ status: 'progress', stage, progress, loaded, total });
				});
			};

			try {
				await installStage('embedding', isEmbeddingModelInstalled, (onProgress) =>
					installEmbeddingModel((progress) => {
						if (progress.status !== 'progress_total') return;
						onProgress(progress.progress, progress.loaded, progress.total);
					})
				);
				await installStage('rerank', isRerankModelInstalled, (onProgress) =>
					installRerankModel((progress) => {
						if (progress.status !== 'progress_total') return;
						onProgress(progress.progress, progress.loaded, progress.total);
					})
				);
				send({ status: 'ready' });
			} catch (error) {
				send({
					status: 'error',
					stage: currentStage,
					message: error instanceof Error ? error.message : 'Search model download failed'
				});
			} finally {
				if (connected) controller.close();
			}
		},
		cancel() {
			connected = false;
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson; charset=utf-8',
			'Cache-Control': 'no-cache'
		}
	});
};
