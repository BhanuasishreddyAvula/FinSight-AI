"""
structure_chunker.py — Groups DocBlocks into logical ParentChunks.

A ParentChunk represents one complete logical section of the document
(e.g., a heading and all the paragraphs/lists/tables beneath it).

Rules (strictly enforced):
  - Never split tables (a table block always stays in one parent)
  - Never split code blocks
  - Never split lists
  - Never merge blocks from different headings into the same parent
  - Heading blocks always start a new parent

Parents are never embedded. They are the context window used for
parent-expansion during retrieval (after Pinecone retrieves child chunks).
"""
from __future__ import annotations
from ingestion.models import DocBlock, ParentChunk

# Block types that must never be split across parent boundaries
_ATOMIC_TYPES = {"table", "code", "list", "figure", "caption"}


def build_parents(
    blocks: list[DocBlock],
    doc_id: str,
    source_file: str,
    doc_type: str,
) -> list[ParentChunk]:
    """
    Group DocBlocks into ParentChunks based on document section structure.

    Each heading starts a new parent. Atomic blocks (tables, code, lists)
    are always kept whole inside their current parent.

    Args:
        blocks:      Ordered list of DocBlocks from any parser.
        doc_id:      UUID string for this document.
        source_file: Original filename.
        doc_type:    "pdf", "docx", or "txt".

    Returns:
        Ordered list of ParentChunks covering all content in the document.
    """
    if not blocks:
        return []

    parents: list[ParentChunk] = []
    current_blocks: list[DocBlock] = []
    current_heading = ""
    current_path: list[str] = []
    current_page: int | None = None

    def _flush(heading: str, path: list[str], page: int | None, block_list: list[DocBlock]) -> None:
        """Commit the current buffer as a new ParentChunk."""
        if not block_list:
            return
        full_text = _blocks_to_text(block_list)
        if not full_text.strip():
            return
        parents.append(ParentChunk(
            parent_id="",          # Filled in by parent_child_index
            doc_id=doc_id,
            source_file=source_file,
            doc_type=doc_type,
            heading=heading,
            section_path=path,
            page_number=page,
            blocks=list(block_list),
            text=full_text,
        ))

    for block in blocks:
        if block.block_type == "heading":
            # Measure current buffer size to prevent orphan chunks
            current_text = _blocks_to_text(current_blocks).strip()
            
            # Only flush if the buffer has substantial content (> 50 chars)
            if current_blocks and len(current_text) > 50:
                # Flush the current buffer before starting a new section
                _flush(current_heading, current_path, current_page, current_blocks)
                # Start fresh for the new section
                current_heading = block.text
                current_path = list(block.section_path) + [block.text]
                current_page = block.page_number
                current_blocks = [block]
            else:
                # Buffer is too small (likely an isolated heading). Accumulate!
                if not current_blocks:
                    current_heading = block.text
                    current_path = list(block.section_path) + [block.text]
                    current_page = block.page_number
                
                # Append the heading to the current buffer so it isn't orphaned
                current_blocks.append(block)
        else:
            # Atomic blocks stay in the current parent — never trigger a flush
            if current_page is None and block.page_number is not None:
                current_page = block.page_number
            current_blocks.append(block)

    # Flush final buffer
    _flush(current_heading, current_path, current_page, current_blocks)

    return parents


def _blocks_to_text(blocks: list[DocBlock]) -> str:
    """
    Render a list of DocBlocks into a single clean text string.

    Tables and code blocks are separated by newlines to preserve structure.
    Other blocks are joined with double-newlines.
    """
    parts = []
    for block in blocks:
        text = block.text.strip()
        if not text:
            continue
        if block.block_type in ("table", "code"):
            parts.append(f"\n{text}\n")
        elif block.block_type == "heading":
            prefix = "#" * max(block.level, 1)
            parts.append(f"{prefix} {text}")
        else:
            parts.append(text)
    return "\n\n".join(parts)
