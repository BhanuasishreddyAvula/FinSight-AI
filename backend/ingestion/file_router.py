"""
file_router.py — Detects file type and runs the full v2 ingestion pipeline.

Pipeline:
  1. Validate file type and size.
  2. Route to the correct structured parser (PDF → Docling, DOCX → python-docx, TXT → heuristic).
  3. Group DocBlocks into ParentChunks (structure_chunker).
  4. Split ParentChunks into ChildChunks (recursive_chunker, token-accurate).
  5. Assign parent/child IDs (parent_child_index).
  6. Return flat child dicts for embedding and Pinecone upsert.

All parsers return the same DocBlock format — only this router changes
for each file type. Everything after parsing is identical.
"""
import os
from pathlib import Path

from ingestion.parsers.txt_parser import parse_txt
from ingestion.parsers.docx_parser import parse_docx
from ingestion.parsers.pdf_parser import parse_pdf
from ingestion.chunkers.structure_chunker import build_parents
from ingestion.chunkers.recursive_chunker import split_parents_into_children
from ingestion.chunkers.parent_child_index import assign_ids, children_to_dicts
from core.config import ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE_MB

from ingestion.models import ParentChunk

def route_file(file_path: str, filename: str, doc_id: str = "") -> tuple[list[dict], list[ParentChunk]]:
    """
    Route a file through the full v2 ingestion pipeline.

    Args:
        file_path: Absolute path to the temporary file on disk.
        filename:  Original uploaded filename (used as source_file in metadata).
        doc_id:    Document UUID (used for deterministic vector IDs).

    Returns:
        Tuple of (flat_child_chunks, parent_chunks).
        Child chunks are sent to Pinecone. Parent chunks are sent to Supabase.
    """
    path = Path(file_path)
    ext = path.suffix.lower()

    # Validate extension
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: {ext}. Allowed: {ALLOWED_EXTENSIONS}")

    # Validate size
    size_mb = os.path.getsize(file_path) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_SIZE_MB:
        raise ValueError(f"File too large: {size_mb:.1f}MB. Max: {MAX_UPLOAD_SIZE_MB}MB")

    # ── Step 1: Parse → list[DocBlock] ────────────────────────────────────────
    if ext == ".txt":
        blocks = parse_txt(file_path)
        doc_type = "txt"
    elif ext == ".docx":
        blocks = parse_docx(file_path)
        doc_type = "docx"
    elif ext == ".pdf":
        blocks = parse_pdf(file_path)
        doc_type = "pdf"
    else:
        raise ValueError(f"Unhandled extension: {ext}")

    if not blocks:
        return []

    # ── Step 2: Structure → list[ParentChunk] ─────────────────────────────────
    parents = build_parents(
        blocks=blocks,
        doc_id=doc_id,
        source_file=filename,
        doc_type=doc_type,
    )

    if not parents:
        return []

    # ── Step 3: Recursive split → list[ChildChunk] ───────────────────────────
    children = split_parents_into_children(parents)

    if not children:
        return []

    # ── Step 4: Assign IDs ────────────────────────────────────────────────────
    parents, children = assign_ids(parents, children)

    # ── Step 4b: Inject Document Outline Chunk ────────────────────────────────
    # This solves whole-document structural queries ("what are the headings")
    # by ensuring a single chunk exists that contains the full document outline.
    outline_lines = ["# Document Outline / Table of Contents"]
    for p in parents:
        if p.heading:
            # indent based on section path depth
            indent = "  " * len(p.section_path)
            outline_lines.append(f"{indent}- {p.heading}")
    # Only inject the outline if we actually found headings
    if len(outline_lines) > 1:
        outline_text = "\n".join(outline_lines)
        
        # Create a synthetic child chunk for the outline
        import uuid
        from ingestion.models import ChildChunk
        outline_chunk = ChildChunk(
            child_id=str(uuid.uuid4()),
            parent_id=str(uuid.uuid4()),  # its own parent
            doc_id=doc_id,
            source_file=filename,
            doc_type=doc_type,
            heading="Document Outline",
            section_path=[],
            page_number=1,
            block_type="outline",
            chunk_index=-1, # negative index so it sorts first if ever needed
            text=outline_text,
        )
        children.insert(0, outline_chunk)

    # Re-index all children sequentially so Pinecone IDs start at 0
    # This prevents the outline chunk (-1) from disappearing due to ID mismatches
    for i, child in enumerate(children):
        child.chunk_index = i

    # ── Step 5: Convert to flat dicts ─────────────────────────────────────────
    return children_to_dicts(children), parents
