"""
parent_expander.py — Reconstructs full parent context from child chunk hits.

After Pinecone retrieves the most relevant child chunks, this module:
  1. Groups children by their parent_id.
  2. Fetches all sibling children that share the same parent.
  3. Reconstructs the complete parent text by joining siblings in order.
  4. Returns expanded context dicts for Cohere reranking and LLM generation.

Why this matters:
  - Pinecone searches small child chunks for maximum retrieval precision.
  - The LLM then receives the COMPLETE parent section for maximum context.
  - This prevents the LLM from seeing fragmented mid-sentence chunks.
"""
from __future__ import annotations
from storage.supabase_client import fetch_parents


def expand_to_parents(
    child_hits: list[dict],
    session_id: str,
) -> list[dict]:
    """
    Expand a list of child chunk hits into full parent context blocks using Supabase.

    Children that share the same parent_id are merged into one context block.
    Children without a parent_id are passed through as-is.

    Args:
        child_hits:  List of child chunk dicts from hybrid_query().
        session_id:  Pinecone namespace (no longer needed for parent fetching, but kept for signature).

    Returns:
        List of expanded context dicts. Each dict has the same shape as
        a child hit but with the full parent text in the "text" field.
    """
    if not child_hits:
        return []

    # 1. Extract all unique parent IDs to perform a single bulk fetch
    unique_parent_ids = set()
    for hit in child_hits:
        pid = hit.get("parent_id")
        if pid:
            unique_parent_ids.add(pid)

    # 2. Lightning fast bulk fetch from Supabase
    parents_map = fetch_parents(list(unique_parent_ids))

    # 3. Build expanded results (deduplicated by parent)
    seen_parent_ids: set[str] = set()
    expanded: list[dict] = []

    for hit in child_hits:
        parent_id = hit.get("parent_id", "")

        # Old-format chunk (no parent_id) — pass through directly
        if not parent_id:
            expanded.append(hit)
            continue

        # Already expanded this parent from a previous sibling hit
        if parent_id in seen_parent_ids:
            continue
        
        seen_parent_ids.add(parent_id)

        # Get the full parent text from our bulk fetch, fallback to child text if missing
        parent_text = parents_map.get(parent_id, hit.get("text", ""))

        # Use the hit's metadata for provenance
        expanded.append({
            "id": hit["id"],
            "score": hit["score"],
            "text": parent_text,
            "source_file": hit.get("source_file", ""),
            "page": hit.get("page"),
            "doc_id": hit.get("doc_id", ""),
            "parent_id": parent_id,
            "heading": hit.get("heading", ""),
            "section_path": hit.get("section_path", ""),
            "block_type": hit.get("block_type", "paragraph"),
        })

    return expanded
