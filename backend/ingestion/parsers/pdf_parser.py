"""
pdf_parser.py — PDF extraction using pymupdf4llm.

Uses pymupdf4llm to convert PDF to Markdown with layout preserved, 
fitted within 512MB RAM free tier limits (fallback available).
"""
from __future__ import annotations
import re
from ingestion.models import DocBlock

def parse_pdf(file_path: str) -> list[DocBlock]:
    """
    Parse a PDF file using pymupdf4llm.
    """
    import pymupdf4llm

    # Extract the entire PDF into a single Markdown string
    md_text = pymupdf4llm.to_markdown(file_path)

    blocks: list[DocBlock] = []
    block_index = 0
    
    # Split by double newlines to separate paragraphs, tables, and lists
    raw_blocks = re.split(r'\n\s*\n', md_text)
    
    for text in raw_blocks:
        text = text.strip()
        if not text:
            continue
            
        block_type = "paragraph"
        level = 0
        
        # Heuristic detection of markdown blocks
        if text.startswith("#"):
            block_type = "heading"
            # count the hashes for level
            level = len(text) - len(text.lstrip("#"))
        elif "|" in text and "-|-" in text:
            block_type = "table"
        elif text.startswith("- ") or text.startswith("* "):
            block_type = "list"
        elif text.startswith("```"):
            block_type = "code"

        blocks.append(
            DocBlock(
                block_type=block_type,
                text=text,
                level=level,
                page_number=None, # pymupdf4llm markdown doesn't natively map back to pages per block
                section_path=[],
                block_index=block_index,
            )
        )
        block_index += 1

    return blocks
