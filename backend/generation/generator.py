"""
generator.py — Streams LLM responses via Groq.
Groq is the sole LLM provider; no fallback.
"""
from groq import AsyncGroq
from core.config import GROQ_API_KEY, GROQ_MODEL, LLM_TEMPERATURE, LLM_MAX_TOKENS


async def stream_answer(prompt: str, api_key: str = None):
    """
    Call Groq and yield response tokens asynchronously.

    Args:
        prompt:  Fully assembled prompt string from prompt_builder.
        api_key: Optional custom Groq API key from the request header.
                 Falls back to the server-side GROQ_API_KEY env var.

    Raises:
        RuntimeError: If no Groq API key is configured.
    """
    effective_key = api_key if api_key and api_key.strip() else GROQ_API_KEY
    if not effective_key or not effective_key.strip():
        raise RuntimeError(
            "No Groq API key configured. Set GROQ_API_KEY in your .env file "
            "or provide one via the Settings panel."
        )

    client = AsyncGroq(api_key=effective_key)
    completion = await client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=LLM_TEMPERATURE,
        max_tokens=LLM_MAX_TOKENS,
        stream=True,
    )
    async for chunk in completion:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
