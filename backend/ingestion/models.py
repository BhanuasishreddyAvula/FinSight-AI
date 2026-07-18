"""
models.py — Unified internal document representation.

Every parser (PDF, DOCX, TXT) must convert its raw output into a list of
DocBlock objects. This ensures the downstream chunking pipeline is
identical regardless of the source file format.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal


# Supported content block types
BlockType = Literal[
    "heading",
    "paragraph",
    "list",
    "table",
    "code",
    "caption",
    "figure",
    "quote",
    "separator",
]


@dataclass
class DocBlock:
    """
    A single atomic unit of document content.

    All parsers produce lists of these. The structure_chunker groups them
    into ParentChunks. The recursive_chunker splits oversized parents
    into ChildChunks.
    """
    block_type: BlockType
    text: str                              # Rendered text content of the block
    level: int = 0                         # Heading level (1-6 for headings, 0 otherwise)
    page_number: int | None = None         # 1-indexed page number (None for TXT/DOCX without pages)
    section_path: list[str] = field(default_factory=list)  # Heading breadcrumb trail
    block_index: int = 0                   # Sequential block position in source document


@dataclass
class ParentChunk:
    """
    A logical section of the document — one or more consecutive DocBlocks
    that belong to the same heading/section context.

    Parents are NEVER embedded. They are the context unit used for
    parent-expansion after retrieval.
    """
    parent_id: str                         # Deterministic UUID assigned by parent_child_index
    doc_id: str
    source_file: str
    doc_type: str
    heading: str                           # The heading that introduces this section
    section_path: list[str]                # Full breadcrumb (e.g. ["Revenue", "Q3 Results"])
    page_number: int | None
    blocks: list[DocBlock]                 # All blocks in this parent section
    text: str = ""                         # Full concatenated text (set by parent_child_index)


@dataclass
class ChildChunk:
    """
    A single embeddable chunk derived from splitting a ParentChunk.

    Only children are embedded and stored in Pinecone.
    """
    child_id: str                          # Unique ID for this specific chunk
    parent_id: str                         # Links back to the ParentChunk
    doc_id: str
    source_file: str
    doc_type: str
    heading: str
    section_path: list[str]
    page_number: int | None
    block_type: BlockType                  # The dominant block type in this chunk
    chunk_index: int                       # Sequential index within the document
    text: str                              # Chunk text to embed and store
