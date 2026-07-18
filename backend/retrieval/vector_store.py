"""
vector_store.py — Pinecone connection, hybrid upsert, and hybrid query.

Architecture:
  - Native Pinecone sparse-dense hybrid search (BM25 + Voyage Finance 2).
  - All documents are namespaced by session_id for tenant isolation.
  - Stores enriched child chunk metadata: parent_id, child_id,
    section_path, heading, block_type (new in v2 ingestion pipeline).

Backward compatible: old chunks without the new fields work fine —
they just won't participate in parent-expansion (graceful degradation).
"""
from pinecone import Pinecone
from pinecone_text.sparse import BM25Encoder

from core.config import (
    PINECONE_API_KEY,
    PINECONE_INDEX_NAME,
    EMBEDDING_DIMENSION,
    HYBRID_ALPHA,
    TOP_K,
)

# ── Singleton clients ─────────────────────────────────────────────────────────
_pc: Pinecone | None = None
_index = None
_bm25: BM25Encoder | None = None


def _get_pinecone():
    global _pc, _index
    if _pc is None:
        _pc = Pinecone(api_key=PINECONE_API_KEY)
        _index = _pc.Index(PINECONE_INDEX_NAME)
    return _index


def _get_bm25() -> BM25Encoder:
    """
    Return a default (pre-trained on MS MARCO) BM25Encoder.
    Stateless — survives server restarts.
    """
    global _bm25
    if _bm25 is None:
        _bm25 = BM25Encoder().default()
    return _bm25


# ── Public API ─────────────────────────────────────────────────────────────────

def upsert_chunks(
    chunks: list[dict],
    dense_vectors: list[list[float]],
    session_id: str,
    doc_id: str,
) -> int:
    """
    Upsert child chunks into Pinecone with dense + sparse vectors
    and enriched metadata.

    New metadata fields (v2 pipeline):
      - parent_id:    Links chunk to its logical parent section.
      - child_id:     Unique ID for this specific child chunk.
      - heading:      Section heading text.
      - section_path: Breadcrumb path (stored as string).
      - block_type:   Dominant content type (paragraph, table, list, etc.)

    Args:
        chunks:        List of chunk dicts from parent_child_index.children_to_dicts().
        dense_vectors: Dense embeddings from embedder.embed_texts().
        session_id:    Pinecone namespace for tenant isolation.
        doc_id:        Document UUID.

    Returns:
        Number of vectors upserted.
    """
    index = _get_pinecone()
    bm25 = _get_bm25()

    texts = [c["text"] for c in chunks]
    sparse_vectors = bm25.encode_documents(texts)

    vectors = []
    for i, (chunk, dense, sparse) in enumerate(zip(chunks, dense_vectors, sparse_vectors)):
        vector_id = f"{doc_id}-{chunk['chunk_index']}"
        vectors.append({
            "id": vector_id,
            "values": dense,
            "sparse_values": sparse,
            "metadata": {
                # Core fields (backward compatible)
                "text": chunk["text"],
                "source_file": chunk["source_file"],
                "chunk_index": chunk["chunk_index"],
                "doc_type": chunk["doc_type"],
                "page": chunk.get("page") or 0,
                "doc_id": doc_id,
                "session_id": session_id,
                # New parent-child fields (v2)
                "parent_id": chunk.get("parent_id", ""),
                "child_id": chunk.get("child_id", vector_id),
                "heading": chunk.get("heading", ""),
                "section_path": chunk.get("section_path", ""),
                "block_type": chunk.get("block_type", "paragraph"),
            },
        })

    # Upsert in batches of 100
    batch_size = 100
    for i in range(0, len(vectors), batch_size):
        index.upsert(vectors=vectors[i : i + batch_size], namespace=session_id)

    return len(vectors)


def hybrid_query(
    dense_vector: list[float],
    query_text: str,
    session_id: str,
    top_k: int = TOP_K,
    alpha: float = HYBRID_ALPHA,
) -> list[dict]:
    """
    Run a hybrid query (sparse + dense) against Pinecone.

    Returns enriched match dicts that include parent_id and heading
    for use by the parent_expander in the retrieval layer.

    Args:
        dense_vector: Query embedding from embedder.embed_query().
        query_text:   Raw query string (for BM25 sparse encoding).
        session_id:   Pinecone namespace.
        top_k:        Number of results to return.
        alpha:        Hybrid weight (0=sparse, 1=dense).

    Returns:
        List of match dicts with enriched metadata.
    """
    index = _get_pinecone()
    bm25 = _get_bm25()

    sparse_vector = bm25.encode_queries(query_text)

    # Scale vectors by alpha for hybrid weighting
    scaled_dense = [v * alpha for v in dense_vector]
    scaled_sparse = {
        "indices": sparse_vector["indices"],
        "values": [v * (1 - alpha) for v in sparse_vector["values"]],
    }

    result = index.query(
        vector=scaled_dense,
        sparse_vector=scaled_sparse,
        top_k=top_k,
        namespace=session_id,
        include_metadata=True,
    )

    results = []
    matches = getattr(result, "matches", result.get("matches", [])) if hasattr(result, "get") else result.matches
    for match in matches:
        meta = match.metadata if hasattr(match, "metadata") else match.get("metadata", {})
        if meta is None:
            meta = {}
        results.append({
            "id": getattr(match, "id", match.get("id", "") if hasattr(match, "get") else ""),
            "score": getattr(match, "score", match.get("score", 0.0) if hasattr(match, "get") else 0.0),
            "text": meta.get("text", "") if isinstance(meta, dict) else getattr(meta, "text", ""),
            "source_file": meta.get("source_file", "") if isinstance(meta, dict) else getattr(meta, "source_file", ""),
            "page": meta.get("page") if isinstance(meta, dict) else getattr(meta, "page", None),
            "doc_id": meta.get("doc_id", "") if isinstance(meta, dict) else getattr(meta, "doc_id", ""),
            "parent_id": meta.get("parent_id", "") if isinstance(meta, dict) else getattr(meta, "parent_id", ""),
            "heading": meta.get("heading", "") if isinstance(meta, dict) else getattr(meta, "heading", ""),
            "section_path": meta.get("section_path", "") if isinstance(meta, dict) else getattr(meta, "section_path", ""),
            "block_type": meta.get("block_type", "paragraph") if isinstance(meta, dict) else getattr(meta, "block_type", "paragraph"),
        })
    return results



def delete_document(doc_id: str, session_id: str) -> None:
    """Delete all vectors for a given document from the session namespace."""
    index = _get_pinecone()
    try:
        index.delete(
            filter={"doc_id": {"$eq": doc_id}},
            namespace=session_id,
        )
    except Exception as e:
        if "404" in str(e) or "Namespace not found" in str(e):
            return  # Namespace doesn't exist, nothing to delete
        raise e


def fetch_document_chunks(doc_id: str, chunk_count: int, session_id: str) -> list[dict]:
    """Fetch raw chunk texts from Pinecone for a specific document."""
    index = _get_pinecone()
    chunk_ids = [f"{doc_id}-{i}" for i in range(chunk_count)]
    response = index.fetch(ids=chunk_ids, namespace=session_id)

    # Pinecone SDK returns a typed FetchResponse object, not a plain dict.
    # Access .vectors attribute which is a dict-like mapping of id → Vector.
    vectors = response.vectors if hasattr(response, "vectors") else {}

    results = []
    for i in range(chunk_count):
        vid = f"{doc_id}-{i}"
        if vid in vectors:
            vec = vectors[vid]
            # Vector metadata may be an object or dict depending on SDK version
            meta = vec.metadata if hasattr(vec, "metadata") else vec.get("metadata", {})
            if meta is None:
                meta = {}
            results.append({
                "chunk_index": i + 1,
                "text": meta.get("text", "") if isinstance(meta, dict) else getattr(meta, "text", ""),
            })
    return results


def verify_document_indexed(doc_id: str, session_id: str, expected_count: int, max_retries: int = 15) -> bool:
    """
    Poll Pinecone to verify that the last chunk of a document has been indexed.
    This solves eventual consistency by blocking until the document is searchable.
    """
    if expected_count <= 0:
        return True
        
    index = _get_pinecone()
    # Check for the last chunk in the document
    last_chunk_id = f"{doc_id}-{expected_count - 1}"
    
    import time
    for _ in range(max_retries):
        try:
            response = index.fetch(ids=[last_chunk_id], namespace=session_id)
            vectors = response.vectors if hasattr(response, "vectors") else {}
            if last_chunk_id in vectors:
                return True
        except Exception:
            pass
        time.sleep(1)
        
    return False
