"""
parent_child_index.py — Assigns deterministic IDs to ParentChunks and ChildChunks.

Responsibilities:
  1. Generates a stable parent_id UUID for each ParentChunk.
  2. Generates a stable child_id UUID for each ChildChunk.
  3. Wires the parent_id into every child that belongs to that parent.
  4. Stores parent text in an in-memory registry keyed by parent_id
     so the parent_expander can reconstruct context during retrieval.

The parent text registry is a module-level dict that lives for the
lifetime of the ingestion request. It does NOT persist to disk because
parent context is reconstructed from Pinecone metadata at query time
via the parent_expander (which fetches all sibling children).
"""
from __future__ import annotations
import uuid
from ingestion.models import ParentChunk, ChildChunk


def assign_ids(
    parents: list[ParentChunk],
    children: list[ChildChunk],
) -> tuple[list[ParentChunk], list[ChildChunk]]:
    """
    Assign parent_id and child_id UUIDs. Wire parent_ids into children.

    Children are matched to parents by their order (structure_chunker and
    recursive_chunker preserve the same sequential order).

    Args:
        parents:  ParentChunks from structure_chunker (parent_id == "").
        children: ChildChunks from recursive_chunker (parent_id and child_id == "").

    Returns:
        (parents, children) with all IDs filled in.
    """
    # Assign a UUID to every parent
    for parent in parents:
        parent.parent_id = str(uuid.uuid4())

    # Map each child to its parent by section_path + heading identity
    # Since the pipeline is sequential and deterministic, we map by
    # matching heading + section_path (sufficient for deduplication)
    parent_lookup: dict[tuple, str] = {}
    for parent in parents:
        key = (_path_key(parent.section_path), parent.heading)
        parent_lookup[key] = parent.parent_id

    for child in children:
        # Wire parent_id
        key = (_path_key(child.section_path), child.heading)
        child.parent_id = parent_lookup.get(key, str(uuid.uuid4()))
        # Assign unique child UUID
        child.child_id = str(uuid.uuid4())

    return parents, children


def _path_key(path: list[str]) -> str:
    return "||".join(path)


def children_to_dicts(children: list[ChildChunk]) -> list[dict]:
    """
    Convert ChildChunk objects into flat dicts compatible with the
    existing vector_store.upsert_chunks() interface.

    The shape matches what upload.py expects so NO changes are needed
    to the upload route.
    """
    return [
        {
            "text": c.text,
            "source_file": c.source_file,
            "chunk_index": c.chunk_index,
            "doc_type": c.doc_type,
            "page": c.page_number,
            # New fields for parent-child architecture
            "child_id": c.child_id,
            "parent_id": c.parent_id,
            "heading": c.heading,
            "section_path": " > ".join(c.section_path) if c.section_path else "",
            "block_type": c.block_type,
        }
        for c in children
    ]
