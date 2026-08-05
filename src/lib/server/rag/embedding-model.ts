import { resolve } from "node:path";
import { setImmediate as yieldEventLoop } from "node:timers/promises";
import {
  env,
  ModelRegistry,
  pipeline,
  type DataType,
  type ProgressCallback,
} from "@huggingface/transformers";

export const EMBEDDING_MODEL = process.env.SEMANTIC_EMBED_MODEL ?? "nomic-ai/nomic-embed-text-v1.5";
export const EMBEDDING_DTYPE = (process.env.SEMANTIC_EMBED_DTYPE ?? "q8") as DataType;
export const EMBEDDING_DIMENSION = 768;
export const LEGACY_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const LEGACY_EMBEDDING_DIMENSION = 384;

const EMBEDDING_BATCH_SIZE = Number(process.env.SEMANTIC_EMBED_BATCH_SIZE ?? "16");
const LEGACY_EMBEDDING_BATCH_SIZE = 32;
const ALLOW_REMOTE_MODELS = process.env.SEMANTIC_EMBED_ALLOW_REMOTE === "1";
const EMBEDDING_CACHE_DIR = process.env.SEMANTIC_EMBED_CACHE_DIR ?? resolve(process.cwd(), ".cache", "transformersjs");

export type EmbeddingType = "search_document" | "search_query";

env.cacheDir = EMBEDDING_CACHE_DIR;
env.localModelPath = EMBEDDING_CACHE_DIR;
env.allowRemoteModels = ALLOW_REMOTE_MODELS;

let embeddingPipeline: Promise<any> | undefined;
let legacyEmbeddingPipeline: Promise<any> | undefined;

export function isEmbeddingModelInstalled() {
  return ModelRegistry.is_pipeline_cached(
    "feature-extraction",
    EMBEDDING_MODEL,
    {
      cache_dir: EMBEDDING_CACHE_DIR,
      dtype: EMBEDDING_DTYPE,
    },
  );
}

export function installEmbeddingModel(onProgress: ProgressCallback) {
  return getEmbeddingPipeline(onProgress);
}

async function getEmbeddingPipeline(onProgress?: ProgressCallback) {
  if (!embeddingPipeline) {
    const started = Date.now();
    console.log(`[Embedding] Loading ${EMBEDDING_MODEL}...`);
    embeddingPipeline = pipeline("feature-extraction", EMBEDDING_MODEL, {
      dtype: EMBEDDING_DTYPE,
      cache_dir: EMBEDDING_CACHE_DIR,
      progress_callback: onProgress,
    })
      .then((loaded) => {
        console.log(`[Embedding] Model ready in ${((Date.now() - started) / 1000).toFixed(1)}s.`);
        return loaded;
      })
      .catch((error) => {
        console.error("[Embedding] Model failed to load.", error);
        embeddingPipeline = undefined;
        throw error;
      });
  }

  return embeddingPipeline;
}

async function getLegacyEmbeddingPipeline() {
  legacyEmbeddingPipeline ??= pipeline(
    "feature-extraction",
    LEGACY_EMBEDDING_MODEL,
    {
      dtype: EMBEDDING_DTYPE,
      cache_dir: EMBEDDING_CACHE_DIR,
    },
  );

  return legacyEmbeddingPipeline;
}

export async function embedTexts(
  texts: string[],
  type: EmbeddingType,
  onProgress?: (current: number, total: number) => void,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const extractor: any = await getEmbeddingPipeline();
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = texts
      .slice(index, index + EMBEDDING_BATCH_SIZE)
      .map((text) => `${type}: ${text}`);

    const output = await extractor(batch, { pooling: "mean", normalize: true });
    embeddings.push(...(output.tolist() as number[][]));
    // The pipeline hands back a raw ONNX tensor - without disposing it, each batch
    // leaks the underlying WASM memory instead of freeing it once we've read the values.
    output.dispose();

    onProgress?.(
      Math.min(index + EMBEDDING_BATCH_SIZE, texts.length),
      texts.length,
    );
    await yieldEventLoop();
  }

  return embeddings;
}

// Documents embedded before the Nomic upgrade retain 384-dimensional MiniLM
// vectors. Query them with the model that created them instead of mixing vector
// spaces or forcing users to reingest every existing document.
export async function embedTextsForStoredDimension(
  texts: string[],
  type: EmbeddingType,
  dimension: number,
): Promise<number[][]> {
  if (dimension === EMBEDDING_DIMENSION) {
    return embedTexts(texts, type);
  }
  if (dimension !== LEGACY_EMBEDDING_DIMENSION) {
    throw new Error(
      `Stored embeddings use unsupported dimension ${dimension}. ` +
        'Run "npm run embeddings:rebuild" before using Semantic or Hybrid search.',
    );
  }
  if (texts.length === 0) return [];

  const extractor: any = await getLegacyEmbeddingPipeline();
  const embeddings: number[][] = [];

  for (let index = 0; index < texts.length; index += LEGACY_EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(index, index + LEGACY_EMBEDDING_BATCH_SIZE);
    const output = await extractor(batch, { pooling: "mean", normalize: true });
    embeddings.push(...(output.tolist() as number[][]));
    output.dispose();
  }

  return embeddings;
}
