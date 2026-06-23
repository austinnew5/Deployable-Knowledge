interface RankedDocument {
    page: number | string;
    source: string;
    text: string;
    score: number;
    [key: string]: any;
}

// Simple text cleaner to make a matching signature
function createTextFingerprint(text: string): string {
    if (!text) return "";
    return text.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30);
}

export function reRankData(bm25Rank: RankedDocument[], vectorRank: RankedDocument[]): RankedDocument[] {
    const bm25: RankedDocument[] = [];
    const vector: RankedDocument[] = [];
    
    // Copy documents over so we don't break the original arrays
    for (const doc of bm25Rank) {
        bm25.push({ ...doc });
    }
    for (const docV of vectorRank) {
        vector.push({ ...docV });
    }
    
    let counter = 1;
    const weightBM25 = 0.411111;
    const weightVec = 0.588888;

    // Assign ranks to BM25
    for (const i of bm25) {
        i["score"] = counter;
        counter = counter + 1;
    }
    
    // Assign ranks to Vector
    counter = 1;
    for (const j of vector) {
        j["score"] = counter;
        counter = counter + 1;
    }

    const reRankedScores: RankedDocument[] = [];
    const matchedKeys: string[] = [];  // Keeps track of unique signatures we already merged

    // Loop through BM25 and look for matches in Vector
    for (const doc of bm25) {
        const bmScore = weightBM25 / (60 + doc["score"]);
        let vecScore = weightVec / (60 + 100); // Default penalty rank
        
        const docFingerprint = createTextFingerprint(doc["text"]);
        
        for (const docV of vector) {
            const vectorFingerprint = createTextFingerprint(docV["text"]);
            
            // Check if source, page, and text content match up
            if (
                doc["page"] === docV["page"] && 
                doc["source"] === docV["source"] && 
                docFingerprint === vectorFingerprint && 
                docFingerprint !== ""
            ) {
                vecScore = weightVec / (60 + docV["score"]);
                
                // Track this specific chunk as matched
                const uniqueKey = `${docV["source"]}::${docV["page"]}::${vectorFingerprint}`;
                matchedKeys.push(uniqueKey);
                break;
            }
        }
                
        const newScore = bmScore + vecScore; 
        doc["score"] = newScore; 
        reRankedScores.push(doc);
    }

    // Loop through Vector for anything that didn't match BM25
    for (const k of vector) {
        const vectorFingerprint = createTextFingerprint(k["text"]);
        const uniqueKey = `${k["source"]}::${k["page"]}::${vectorFingerprint}`;

        // If this specific chunk key isn't in our matched list
        if (!matchedKeys.includes(uniqueKey)) {
            const bmScore = weightBM25 / (60 + 100); // Default penalty rank
            const vecScore = weightVec / (60 + k["score"]); 
            const newScore = bmScore + vecScore;

            k["score"] = newScore; 
            reRankedScores.push(k);
        }
    }

    // Final sort descending by score
    return reRankedScores.sort((a, b) => b.score - a.score);
}