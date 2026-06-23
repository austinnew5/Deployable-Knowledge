import * as bm25s from 'bm25s';
// @ts-ignore - snowball-stemmer might not have native types definitions
import Stemmer from 'snowball-stemmer.jsx';

// --- Type Definitions ---
interface ChunkRecord {
    text: string;
    page: number | string;
    file_name: string;
}

interface PicData {
    file_name: string;
    page: number | string;
}

interface SearchResult {
    text: string;
    source: string;
    score: number;
    page: string;
    content_type: string;
    image_index: number | null;
    segment_id: number;
}

// Mocking your KnowledgeBaseStore and DB operations
class KnowledgeBaseStore {
    getAllChunks(): ChunkRecord[] {
        // Your database logic fetching chunks goes here
        return [];
    }
}

/**
 * Replaces Python's contextmanager stdout suppressor.
 * Node.js equivalent redirects process.stdout.write temporarily.
 */
function suppressStdout<T>(callback: () => T): T {
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true; // No-op
    try {
        return callback();
    } finally {
        process.stdout.write = originalWrite;
    }
}

function getCorpus(query: string, topK: number, exclude: any[]): [string[], (number | string)[], PicData[]] {
    const kbStore = new KnowledgeBaseStore();
    const allChunks = kbStore.getAllChunks();

    const corpusText: string[] = [];
    const corpusPageNum: (number | string)[] = [];
    const corpusPicData: PicData[] = [];

    for (const entry of allChunks) {
        corpusText.push(entry.text);
        corpusPageNum.push(entry.page);
        corpusPicData.push({ file_name: entry.file_name, page: entry.page });
    }

    return [corpusText, corpusPageNum, corpusPicData];
}

function testQuery(): string {
    return "How do I perform a 9-line when reporting an injured soldier?";
}

function tokenizeCorpus(corpusText: string[]): bm25s.BM25 {
    const stemmer = new Stemmer.English();
    
    // bm25s JS syntax requires passing a tokenization step or custom preprocessing
    const corpusTokens = bm25s.tokenize(corpusText, { 
        stopwords: "english", 
        stemmer: (word: string) => stemmer.stem(word) 
    });
    
    const corpusIndex = new bm25s.BM25();
    corpusIndex.index(corpusTokens);
    
    return corpusIndex;
}

function tokenizeQuery(queryText: string): string[] {
    const stemmer = new Stemmer.English();
    const queryTokens = bm25s.tokenize([queryText], { 
        stopwords: "english", 
        stemmer: (word: string) => stemmer.stem(word) 
    })[0]; // bm25s returns an array of token arrays
    
    return queryTokens;
}

function ranker(queryTokens: string[], corpusIndex: bm25s.BM25, topK: number): { results: number[][], scores: number[][] } {
    // Returns results multidimensional array and corresponding scores
    const { results, scores } = corpusIndex.retrieve([queryTokens], { k: Math.floor(topK), sorted: true });
    return { results, scores };
}

function finalResults(
    results: number[][], 
    scores: number[][], 
    corpusText: string[], 
    corpusData: (number | string)[], 
    picData: PicData[], 
    topK: number
): SearchResult[] {
    const collectedResults: SearchResult[] = [];
    
    // results[0] contains the indices for the first (and only) query sequence
    if (!results || results.length === 0) return collectedResults;

    for (let i = 0; i < results[0].length; i++) {
        const doc = results[0][i];
        const score = scores[0][i];

        collectedResults.push({
            text: String(corpusText[doc]).trim().replace(/\n/g, " "),
            source: String(picData[doc].file_name),
            score: Number(score),
            page: String(corpusData[doc]),
            content_type: "text",
            image_index: null,
            segment_id: 1,
        });
    }

    return collectedResults;
}

export function runBM(query: string, topK: number, excludeSources: any[]): SearchResult[] {
    const [corpus, pageNum, picData] = getCorpus(query, topK, excludeSources);
    
    const corpusIndex = tokenizeCorpus(corpus);
    const queryTokens = tokenizeQuery(query);
    const { results, scores } = ranker(queryTokens, corpusIndex, topK);
    
    const collectedResults = finalResults(results, scores, corpus, pageNum, picData, topK);
    return collectedResults;
}