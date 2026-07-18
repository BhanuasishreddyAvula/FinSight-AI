"""
hybrid_retriever.py — High-level retrieval interface (v2).

Pipeline:
  1. Embed query (dense).
  2. Hybrid search in Pinecone (child chunks only).
  3. Deduplicate by text content.
  4. Expand child hits to full parent context sections.
  5. Cohere Rerank on expanded context (if key configured).
  6. Return top-K ranked context dicts for prompt building.

The LLM always receives COMPLETE parent sections, never isolated child
fragments. This dramatically improves answer grounding.
"""
from retrieval.vector_store import hybrid_query
from retrieval.parent_expander import expand_to_parents
from ingestion.embedder import embed_query
from core.config import TOP_K, HYBRID_ALPHA

MIN_SCORE_THRESHOLD = 0.0  # Set > 0 to filter very weak matches


def retrieve(
    query: str,
    session_id: str,
    top_k: int = TOP_K,
    alpha: float = HYBRID_ALPHA,
    api_key: str = None,
) -> list[dict]:
    """
    Main retrieval function called by the query endpoint.

    1. Embeds the query as a dense vector.
    2. Runs Pinecone hybrid query (returns child chunk hits).
    3. Deduplicates by text.
    4. Expands child hits to full parent context sections.
    5. Cohere reranks expanded contexts (if key configured).
    6. Returns top-K results.

    Args:
        query:      Raw user question.
        session_id: Namespace to restrict search to this user's documents.
        top_k:      Final number of context blocks to return.
        alpha:      Hybrid weighting (0=sparse, 1=dense).
        api_key:    Optional custom Voyage API key.

    Returns:
        List of ranked context dicts with text, source, score, and page.
    """
    from core.config import COHERE_API_KEY

    # Pull a larger candidate pool when Cohere is available for reranking
    # After parent expansion, the text is larger so we need fewer candidates
    candidate_top_k = max(top_k * 3, 20) if COHERE_API_KEY else top_k

    # Step 1: Embed the query (dense)
    dense_vector = embed_query(query, api_key=api_key)

    # Step 2 + 3: Hybrid query via Pinecone (child chunks, namespaced)
    child_hits = hybrid_query(
        dense_vector=dense_vector,
        query_text=query,
        session_id=session_id,
        top_k=candidate_top_k,
        alpha=alpha,
    )

    # Step 4: Deduplicate child hits by text content
    seen_texts: set[str] = set()
    unique_hits: list[dict] = []
    for hit in child_hits:
        text_key = hit["text"][:100]
        if text_key not in seen_texts and hit["score"] >= MIN_SCORE_THRESHOLD:
            seen_texts.add(text_key)
            unique_hits.append(hit)

    # Step 5: Expand child hits to full parent context sections
    # Each unique parent_id → one expanded context block with the full section text
    expanded = expand_to_parents(unique_hits, session_id)

    # Step 6: Cohere Rerank on expanded parent contexts (if key configured)
    if COHERE_API_KEY and expanded:
        try:
            import cohere
            co = cohere.Client(COHERE_API_KEY)

            response = co.rerank(
                model="rerank-english-v3.0",
                query=query,
                documents=[m["text"] for m in expanded],
                top_n=top_k,
            )

            reranked: list[dict] = []
            for result in response.results:
                match = expanded[result.index]
                match["score"] = float(result.relevance_score)
                reranked.append(match)
            return reranked

        except Exception as e:
            print(f"Warning: Cohere Rerank failed, falling back to Pinecone ranking: {e}")
            return expanded[:top_k]

    return expanded[:top_k]
