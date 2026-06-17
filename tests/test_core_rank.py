import sys
import pathlib

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from core.rag.rank import reRankData


def test_rerank_matches_and_preserves_vector_only_docs():
    bm25 = [
        {"page": 1, "source": "doc1", "score": 0},
        {"page": 2, "source": "doc2", "score": 0},
    ]
    vector = [
        {"page": 1, "source": "doc1", "score": 0},
        {"page": 3, "source": "doc3", "score": 0},
    ]

    ranked = reRankData(bm25, vector)

    assert len(ranked) == 3
    assert ranked[0]["page"] == 1
    assert any(item["page"] == 3 for item in ranked)
    assert any(item["page"] == 2 for item in ranked)
