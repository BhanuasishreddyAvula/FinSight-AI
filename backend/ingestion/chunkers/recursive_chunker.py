"""
recursive_chunker.py — Token-accurate recursive splitting of ParentChunks into ChildChunks.

Splitting is block-aware:
  - Atomic blocks (table, code, list) are never split — they are kept as a
    single child chunk even if oversized.
  - Text blocks are split using a recursive hierarchy:
      Heading → Paragraph → Sentence → Token

Chunk sizing uses tiktoken for accurate token counts
(not character counts, which are misleading for dense financial text).

Target:  500 tokens per child chunk
Overlap: 75 tokens between consecutive children
"""
from __future__ import annotations
import re
import tiktoken
from core.config import CHUNK_SIZE, CHUNK_OVERLAP
from ingestion.models import ParentChunk, ChildChunk, DocBlock

# Atomic block types that must never be split
_ATOMIC_TYPES = {"table", "code", "list", "figure", "caption"}

# Sentence boundary pattern
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def _get_encoder() -> tiktoken.Encoding:
    """Return a tiktoken encoder. cl100k_base covers GPT-4 and Llama 3 vocabularies."""
    return tiktoken.get_encoding("cl100k_base")


def _token_count(text: str, enc: tiktoken.Encoding) -> int:
    return len(enc.encode(text))


def split_parents_into_children(parents: list[ParentChunk]) -> list[ChildChunk]:
    """
    Split every ParentChunk into one or more ChildChunks.

    Small parents that fit within CHUNK_SIZE tokens are kept as a single child.
    Large parents are recursively split at block boundaries first, then at
    sentence boundaries, then at token boundaries as a last resort.

    Args:
        parents: Ordered list of ParentChunks from structure_chunker.

    Returns:
        Ordered list of ChildChunks ready for embedding.
    """
    enc = _get_encoder()
    children: list[ChildChunk] = []
    chunk_index = 0

    for parent in parents:
        child_texts = _split_parent(parent, enc)

        # Add overlap between consecutive children of the same parent
        child_texts_with_overlap = _apply_overlap(child_texts, enc)

        dominant_type = _dominant_block_type(parent.blocks)

        for text in child_texts_with_overlap:
            text = text.strip()
            if not text:
                continue
            children.append(ChildChunk(
                child_id="",                    # Filled by parent_child_index
                parent_id=parent.parent_id,     # Also filled by parent_child_index
                doc_id=parent.doc_id,
                source_file=parent.source_file,
                doc_type=parent.doc_type,
                heading=parent.heading,
                section_path=parent.section_path,
                page_number=parent.page_number,
                block_type=dominant_type,
                chunk_index=chunk_index,
                text=text,
            ))
            chunk_index += 1

    return children


def _split_parent(parent: ParentChunk, enc: tiktoken.Encoding) -> list[str]:
    """
    Split a parent's blocks into text segments that fit within CHUNK_SIZE tokens.
    Atomic blocks are never split.
    """
    segments: list[str] = []
    current_parts: list[str] = []
    current_tokens = 0

    def flush():
        nonlocal current_parts, current_tokens
        if current_parts:
            segments.append("\n\n".join(current_parts))
            current_parts = []
            current_tokens = 0

    for block in parent.blocks:
        block_text = block.text.strip()
        if not block_text:
            continue

        block_tokens = _token_count(block_text, enc)

        # Atomic block: keep whole, but don't arbitrarily isolate it
        if block.block_type in _ATOMIC_TYPES:
            if current_tokens + block_tokens <= CHUNK_SIZE:
                current_parts.append(block_text)
                current_tokens += block_tokens
            else:
                # If current buffer is tiny (like an orphan heading), attach it to avoid fragmentation
                if 0 < current_tokens < 50:
                    current_parts.append(block_text)
                    flush()
                else:
                    flush()
                    segments.append(block_text)
            continue

        # Fits in current chunk?
        if current_tokens + block_tokens <= CHUNK_SIZE:
            current_parts.append(block_text)
            current_tokens += block_tokens
        else:
            # Flush and try to split the oversized block by sentence
            flush()
            sentence_splits = _split_by_sentences(block_text, enc)
            for seg in sentence_splits:
                seg_tokens = _token_count(seg, enc)
                if current_tokens + seg_tokens <= CHUNK_SIZE:
                    current_parts.append(seg)
                    current_tokens += seg_tokens
                else:
                    flush()
                    # Last resort: hard token split
                    if seg_tokens > CHUNK_SIZE:
                        for hard_chunk in _hard_token_split(seg, enc):
                            segments.append(hard_chunk)
                    else:
                        current_parts.append(seg)
                        current_tokens = seg_tokens

    flush()
    return segments


def _split_by_sentences(text: str, enc: tiktoken.Encoding) -> list[str]:
    """Split text at sentence boundaries."""
    sentences = _SENTENCE_END.split(text)
    groups: list[str] = []
    current: list[str] = []
    current_tokens = 0

    for sentence in sentences:
        s_tokens = _token_count(sentence, enc)
        if current_tokens + s_tokens <= CHUNK_SIZE:
            current.append(sentence)
            current_tokens += s_tokens
        else:
            if current:
                groups.append(" ".join(current))
            current = [sentence]
            current_tokens = s_tokens

    if current:
        groups.append(" ".join(current))
    return groups


def _hard_token_split(text: str, enc: tiktoken.Encoding) -> list[str]:
    """Last-resort: split by raw token windows."""
    token_ids = enc.encode(text)
    chunks = []
    for start in range(0, len(token_ids), CHUNK_SIZE):
        chunk_ids = token_ids[start : start + CHUNK_SIZE]
        chunks.append(enc.decode(chunk_ids))
    return chunks


def _apply_overlap(segments: list[str], enc: tiktoken.Encoding) -> list[str]:
    """
    Add a trailing overlap from the previous segment to the start of the next.
    Only applied to text segments (overlap across atomic blocks is skipped).
    """
    if len(segments) <= 1 or CHUNK_OVERLAP <= 0:
        return segments

    result = [segments[0]]
    for i in range(1, len(segments)):
        prev = segments[i - 1]
        # Take last CHUNK_OVERLAP tokens from previous segment
        prev_tokens = enc.encode(prev)
        overlap_tokens = prev_tokens[-CHUNK_OVERLAP:] if len(prev_tokens) > CHUNK_OVERLAP else prev_tokens
        overlap_text = enc.decode(overlap_tokens).strip()
        if overlap_text:
            result.append(overlap_text + "\n\n" + segments[i])
        else:
            result.append(segments[i])

    return result


def _dominant_block_type(blocks: list[DocBlock]) -> str:
    """Return the most common block type in a list of blocks."""
    if not blocks:
        return "paragraph"
    counts: dict[str, int] = {}
    for b in blocks:
        counts[b.block_type] = counts.get(b.block_type, 0) + 1
    return max(counts, key=lambda k: counts[k])
