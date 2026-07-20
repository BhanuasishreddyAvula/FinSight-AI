"""
embedder.py — Embeds text chunks using Google's text-embedding-004 model.

Produces DENSE vectors (768-dim) for Pinecone hybrid upsert.
Sparse BM25 vectors are handled in vector_store.py via Pinecone's BM25Encoder.
"""
import voyageai
from core.config import VOYAGE_API_KEY, EMBEDDING_MODEL

# Initialize Voyage AI client
vo = voyageai.Client(api_key=VOYAGE_API_KEY)


import time

def embed_texts(texts: list[str], api_key: str = None) -> list[list[float]]:
    """
    Embed a list of text strings using voyage-finance-2.
    Includes exponential backoff for handling 3 RPM rate limits on the free tier.
    """
    client = voyageai.Client(api_key=api_key) if api_key else vo
    max_retries = 5
    base_delay = 10  # Base delay in seconds
    
    for attempt in range(max_retries):
        try:
            # Voyage Client handles internal batching efficiently
            result = client.embed(
                texts=texts,
                model=EMBEDDING_MODEL,
                input_type="document",
            )
            return result.embeddings
        except Exception as e:
            error_str = str(e).lower()
            if "rate limit" in error_str or "429" in error_str:
                if attempt == max_retries - 1:
                    raise Exception(f"VoyageAI rate limit exceeded after {max_retries} retries: {str(e)}")
                
                # Exponential backoff (10s, 20s, 40s, 80s) to comfortably pass the 1-minute window
                sleep_time = base_delay * (2 ** attempt)
                print(f"Rate limited by VoyageAI. Retrying in {sleep_time} seconds (attempt {attempt + 1}/{max_retries})...")
                time.sleep(sleep_time)
            else:
                # Re-raise immediately if it's not a rate limit error
                raise


def embed_query(query: str, api_key: str = None) -> list[float]:
    """
    Embed a single user query for retrieval.
    """
    client = voyageai.Client(api_key=api_key) if api_key else vo
    result = client.embed(
        texts=[query],
        model=EMBEDDING_MODEL,
        input_type="query",
    )
    return result.embeddings[0]
