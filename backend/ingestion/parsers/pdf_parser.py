"""
pdf_parser.py — Structured PDF extraction using Docling.

Docling uses a layout-aware deep learning model to detect:
- Heading hierarchy
- Paragraphs
- Tables (with cell structure)
- Lists
- Figures and captions
- Code blocks
- Reading order

Returns a list of DocBlock objects — the unified internal representation
used by all downstream chunking stages.

First run downloads ~1.5 GB of model weights and caches them locally.
Subsequent runs are fast.
"""
from __future__ import annotations
import re
from ingestion.models import DocBlock


def parse_pdf(file_path: str) -> list[DocBlock]:
    """
    Parse a PDF file using Docling and return a list of structured DocBlocks.

    Args:
        file_path: Absolute path to the PDF file.

    Returns:
        List of DocBlock objects preserving document structure.
    """
    # Lazy import — Docling is heavy and shouldn't block server startup
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(file_path)
    doc = result.document

    blocks: list[DocBlock] = []
    block_index = 0
    section_stack: list[str] = []       # tracks current heading breadcrumb

    for item, level in doc.iterate_items():
        # Determine block type and text from Docling item types
        from docling_core.types.doc import (
            SectionHeaderItem,
            TextItem,
            TableItem,
            PictureItem,
            ListItem,
        )

        text = ""
        block_type = "paragraph"
        heading_level = 0
        page_num: int | None = None

        # Extract page number from provenance
        if hasattr(item, "prov") and item.prov:
            try:
                page_num = item.prov[0].page_no
            except (IndexError, AttributeError):
                page_num = None

        if isinstance(item, SectionHeaderItem):
            text = item.text.strip()
            if not text:
                continue
            block_type = "heading"
            heading_level = getattr(item, "level", 1) or 1

            # Update the section breadcrumb stack
            # Pop levels >= current heading level
            while section_stack and _heading_level(section_stack[-1]) >= heading_level:
                section_stack.pop()
            section_stack.append(text)

        elif isinstance(item, ListItem):
            text = item.text.strip()
            if not text:
                continue
            block_type = "list"

        elif isinstance(item, TableItem):
            # Render the table as pipe-separated rows
            try:
                # Pass doc to avoid deprecation warning (required in newer Docling versions)
                table_data = item.export_to_dataframe(doc=doc)
                rows = []
                for _, row in table_data.iterrows():
                    rows.append(" | ".join(str(v) for v in row.values))
                text = "\n".join(rows)
            except Exception:
                # Fallback to markdown export if dataframe fails
                text = item.export_to_markdown() if hasattr(item, "export_to_markdown") else ""
            if not text.strip():
                continue
            block_type = "table"

        elif isinstance(item, PictureItem):
            # Use caption text if available
            caption = ""
            if hasattr(item, "captions") and item.captions:
                caption = " ".join(
                    c.text for c in item.captions if hasattr(c, "text") and c.text
                )
            if caption.strip():
                text = f"[Figure] {caption.strip()}"
                block_type = "figure"
            else:
                continue  # skip figures with no caption

        elif isinstance(item, TextItem):
            text = item.text.strip()
            if not text:
                continue
            # Detect code blocks heuristically (monospace or indented blocks)
            if _looks_like_code(text):
                block_type = "code"
            else:
                block_type = "paragraph"
        else:
            # Unknown item type — try to get text
            text = getattr(item, "text", "").strip()
            if not text:
                continue
            block_type = "paragraph"

        blocks.append(
            DocBlock(
                block_type=block_type,
                text=text,
                level=heading_level,
                page_number=page_num,
                section_path=list(section_stack[:-1] if block_type == "heading" else section_stack),
                block_index=block_index,
            )
        )
        block_index += 1

    return blocks


def _heading_level(heading_text: str) -> int:
    """Estimate heading level from text length — shorter = higher level."""
    return 1 if len(heading_text) < 20 else 2


def _looks_like_code(text: str) -> bool:
    """Heuristic: text that looks like source code."""
    code_indicators = [
        text.startswith("    ") or text.startswith("\t"),
        bool(re.search(r"(def |class |import |#include|function |var |const |let )", text)),
        text.count("{") > 1 and text.count("}") > 1,
    ]
    return sum(code_indicators) >= 2
