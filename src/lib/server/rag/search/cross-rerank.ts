// Cross-encoder relevance scorer.

import {
	AutoModelForSequenceClassification,
	AutoTokenizer,
	ModelRegistry,
	type ProgressCallback
} from '@huggingface/transformers';
import { INFERENCE_THREADS, TRANSFORMERS_CACHE_DIR } from '../embedding-model';

export const RERANK_MODEL = 'Xenova/ms-marco-MiniLM-L-6-v2';

export type RerankCandidate = {
	chunkId: string;
	content: string;
};

type Tokenizer = Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
type ClassificationModel = Awaited<
	ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>
>;

let tokenizer: Tokenizer | undefined;
let model: ClassificationModel | undefined;

export function isRerankModelInstalled(): Promise<boolean> {
	return ModelRegistry.is_cached(RERANK_MODEL, { cache_dir: TRANSFORMERS_CACHE_DIR });
}

async function initializeModel(progress_callback?: ProgressCallback) {
	if (!tokenizer) {
		tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL, { progress_callback });
	}
	if (!model) {
		model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
			session_options: { intraOpNumThreads: INFERENCE_THREADS, interOpNumThreads: 1 },
			progress_callback
		});
	}

	return { tokenizer, model };
}

// Explicit install step so the reranker is never a silent first-use network
// dependency — mirrors installEmbeddingModel in ../embedding-model.
export function installRerankModel(progress_callback: ProgressCallback): Promise<void> {
	return initializeModel(progress_callback).then(() => undefined);
}

export type RerankedCandidate = RerankCandidate & { relevance: number };

export async function rerankCandidates(
	query: string,
	candidates: RerankCandidate[]
): Promise<RerankedCandidate[]> {
	const uniqueCandidates = [
		...new Map(candidates.map((candidate) => [candidate.chunkId, candidate])).values()
	];

	if (uniqueCandidates.length === 0) return [];

	const { tokenizer, model } = await initializeModel();

	const queries = new Array(uniqueCandidates.length).fill(query);
	const passages = uniqueCandidates.map((candidate) => candidate.content);
	const encodedInputs = await tokenizer(queries, {
		text_pair: passages,
		padding: true,
		truncation: true,
		max_length: 512
	});
	const { logits } = await model(encodedInputs);

	return uniqueCandidates
		.map((candidate, index) => ({
			candidate,
			logit: Number(logits.data[index])
		}))
		.sort((left, right) => right.logit - left.logit)
		.map(({ candidate, logit }) => ({
			...candidate,
			relevance: 1 / (1 + Math.exp(-logit))
		}));
}
