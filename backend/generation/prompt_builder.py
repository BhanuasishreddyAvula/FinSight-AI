"""
prompt_builder.py — Assembles the final prompt sent to the LLM.

Combines:
1. System instruction (strict grounding rules)
2. Retrieved document chunks (with source labels)
3. Conversation history (last N turns from Supabase)
4. Current user question
"""


SYSTEM_PROMPT = """You are an intelligent, highly accurate document analysis assistant.
You answer questions STRICTLY and ONLY based on the provided document context below.

Rules:
1. Only use information from the provided Context sections to answer.
2. If the answer is not in the context, say exactly:
   "Sorry, I couldn't find this information in the uploaded documents."
3. Answer strictly and concisely to the user's question. Be brief and right to the point. Do NOT write long summaries unless explicitly asked. If there is a critical detail or caveat in the text that the user must know, add it as a single short sentence at the end.
4. Do not hallucinate or add any outside knowledge. Only use information explicitly present in the document.
5. Group related information logically. If you include adjacent concepts, simply clarify that in your response.
6. Structure your answers clearly using headings, bullet points, or numbered lists where appropriate."""


def build_prompt(
    query: str,
    retrieved_chunks: list[dict],
    history: list[dict],
) -> str:
    """
    Construct the full prompt string for the LLM.

    Args:
        query: The current user question.
        retrieved_chunks: List of chunk dicts from hybrid_retriever.retrieve().
        history: List of {role, content} dicts from memory.get_history().

    Returns:
        A formatted prompt string.
    """
    # Format retrieved context blocks with source labels
    if retrieved_chunks:
        context_blocks = []
        for i, chunk in enumerate(retrieved_chunks, start=1):
            page_info = f", p.{chunk['page']}" if chunk.get("page") else ""
            heading = chunk.get("heading", "")
            section_path = chunk.get("section_path", "")

            # Build a rich header with structural context
            header_parts = [f"[{i}] Source: {chunk['source_file']}{page_info}"]
            if section_path:
                header_parts.append(f"Section: {section_path}")
            elif heading:
                header_parts.append(f"Section: {heading}")
            header = " | ".join(header_parts)
            context_blocks.append(f"{header}\n{chunk['text']}")
        context_section = "\n\n---\n\n".join(context_blocks)
    else:
        context_section = "No relevant document sections were found for this query."

    # Format conversation history
    if history:
        history_lines = []
        for turn in history:
            role = "User" if turn["role"] == "user" else "Assistant"
            history_lines.append(f"{role}: {turn['content']}")
        history_section = "\n".join(history_lines)
    else:
        history_section = "(No prior conversation)"

    # Assemble final prompt
    prompt = f"""{SYSTEM_PROMPT}

━━━ DOCUMENT CONTEXT ━━━
{context_section}

━━━ CONVERSATION HISTORY ━━━
{history_section}

━━━ CURRENT QUESTION ━━━
{query}

━━━ ANSWER ━━━"""

    return prompt


def build_no_context_response() -> str:
    """Standard fallback message when no chunks are retrieved."""
    return (
        "Sorry, I couldn't find relevant information in the uploaded documents. "
        "Please make sure you've uploaded the relevant financial reports "
        "and that your question relates to their contents."
    )
