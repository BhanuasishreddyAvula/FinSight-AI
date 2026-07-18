"""
txt_parser.py — Structured plain-text extraction with heuristic heading detection.

Detects the following heading styles in plain text:
  - Markdown headings:       # Title, ## Section, ### Subsection
  - Numbered headings:       1. Title, 1.1 Section, 1.1.1 Sub
  - Underlined headings:     Title\n=====  or  Title\n-----
  - ALLCAPS short lines:     EXECUTIVE SUMMARY (< 60 chars, all caps)

Everything else is treated as a paragraph or list item.

Returns a list of DocBlock objects compatible with the unified pipeline.
"""
from __future__ import annotations
import re
from ingestion.models import DocBlock


# Regex patterns for heading detection
_MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.+)$")
_NUMBERED_HEADING = re.compile(r"^(\d+(?:\.\d+)*)\.\s+(.+)$")
_ALLCAPS_HEADING = re.compile(r"^[A-Z][A-Z0-9\s\-:,&]+$")
_LIST_ITEM = re.compile(r"^(\s*[-*•]\s+|\s*\d+\.\s+|\s*[a-z]\)\s+)")


def parse_txt(file_path: str) -> list[DocBlock]:
    """
    Parse a plain-text file and return a list of structured DocBlocks.

    Args:
        file_path: Absolute path to the .txt file.

    Returns:
        List of DocBlock objects with best-effort structure detection.
    """
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    lines = content.splitlines()
    blocks: list[DocBlock] = []
    block_index = 0
    section_stack: list[tuple[int, str]] = []  # (level, text)

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i += 1
            continue

        # ── Underlined heading (next line is === or ---) ──────────────────────
        if i + 1 < len(lines):
            next_line = lines[i + 1].strip()
            if next_line and len(next_line) >= 3 and all(c in "=-" for c in next_line):
                level = 1 if next_line[0] == "=" else 2
                section_stack, path = _update_stack(section_stack, level, stripped)
                blocks.append(DocBlock(
                    block_type="heading",
                    text=stripped,
                    level=level,
                    page_number=None,
                    section_path=path,
                    block_index=block_index,
                ))
                block_index += 1
                i += 2  # skip underline
                continue

        # ── Markdown heading ──────────────────────────────────────────────────
        m = _MARKDOWN_HEADING.match(stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2).strip()
            section_stack, path = _update_stack(section_stack, level, text)
            blocks.append(DocBlock(
                block_type="heading",
                text=text,
                level=level,
                page_number=None,
                section_path=path,
                block_index=block_index,
            ))
            block_index += 1
            i += 1
            continue

        # ── Numbered heading (e.g. "1.2 Results") ────────────────────────────
        m = _NUMBERED_HEADING.match(stripped)
        if m:
            numbering = m.group(1)
            text = m.group(2).strip()
            # Count dots to determine depth
            level = numbering.count(".") + 1
            section_stack, path = _update_stack(section_stack, level, text)
            blocks.append(DocBlock(
                block_type="heading",
                text=f"{numbering}. {text}",
                level=level,
                page_number=None,
                section_path=path,
                block_index=block_index,
            ))
            block_index += 1
            i += 1
            continue

        # ── ALLCAPS short line heuristic (section title) ──────────────────────
        if (
            _ALLCAPS_HEADING.match(stripped)
            and len(stripped) < 60
            and len(stripped.split()) >= 2
        ):
            section_stack, path = _update_stack(section_stack, 2, stripped)
            blocks.append(DocBlock(
                block_type="heading",
                text=stripped,
                level=2,
                page_number=None,
                section_path=path,
                block_index=block_index,
            ))
            block_index += 1
            i += 1
            continue

        # ── List item ─────────────────────────────────────────────────────────
        if _LIST_ITEM.match(line):
            current_path = [s[1] for s in section_stack]
            # Collect consecutive list items into a single block
            list_lines = []
            while i < len(lines) and (
                _LIST_ITEM.match(lines[i]) or (lines[i].startswith("  ") and list_lines)
            ):
                if lines[i].strip():
                    list_lines.append(lines[i].strip())
                i += 1
            blocks.append(DocBlock(
                block_type="list",
                text="\n".join(list_lines),
                level=0,
                page_number=None,
                section_path=current_path,
                block_index=block_index,
            ))
            block_index += 1
            continue

        # ── Paragraph — accumulate until blank line ────────────────────────────
        current_path = [s[1] for s in section_stack]
        para_lines = []
        while i < len(lines) and lines[i].strip():
            para_lines.append(lines[i].strip())
            i += 1
        para_text = " ".join(para_lines)
        if para_text:
            blocks.append(DocBlock(
                block_type="paragraph",
                text=para_text,
                level=0,
                page_number=None,
                section_path=current_path,
                block_index=block_index,
            ))
            block_index += 1

    return blocks


def _update_stack(
    stack: list[tuple[int, str]], new_level: int, new_text: str
) -> tuple[list[tuple[int, str]], list[str]]:
    """
    Update the heading stack for a new heading. Returns (new_stack, path_before).
    path_before is the section_path for the heading block itself.
    """
    while stack and stack[-1][0] >= new_level:
        stack.pop()
    path_before = [s[1] for s in stack]
    stack.append((new_level, new_text))
    return stack, path_before
