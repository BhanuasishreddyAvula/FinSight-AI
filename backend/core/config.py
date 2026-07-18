"""
FinSight AI — Centralised configuration.
All settings are loaded from environment variables (via .env).
"""
import os
from dotenv import load_dotenv

# Compute absolute path to .env file at workspace root
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(CURRENT_DIR)
BASE_DIR = os.path.dirname(BACKEND_DIR)
ENV_PATH = os.path.join(BASE_DIR, ".env")

load_dotenv(ENV_PATH)

# ── Groq LLM ─────────────────────────────────────────────────────────────────
GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL: str = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# ── Voyage AI & Cohere Rerank ──────────────────────────────────────────────
VOYAGE_API_KEY: str = os.getenv("VOYAGE_API_KEY", "")
COHERE_API_KEY: str = os.getenv("COHERE_API_KEY", "")
EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "voyage-finance-2")

# ── Pinecone ─────────────────────────────────────────────────────────────────
PINECONE_API_KEY: str = os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX_NAME: str = os.getenv("PINECONE_INDEX_NAME", "finsight-index")
# Pinecone dimension for voyage-finance-2 is 1024
EMBEDDING_DIMENSION: int = int(os.getenv("EMBEDDING_DIMENSION", "1024"))

# ── Supabase ─────────────────────────────────────────────────────────────────
SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
SUPABASE_BUCKET: str = os.getenv("SUPABASE_BUCKET", "finsight-documents")

# ── Chunking ─────────────────────────────────────────────────────────────────
CHUNK_SIZE: int = int(os.getenv("CHUNK_SIZE", "500"))          # tokens (tiktoken cl100k_base)
CHUNK_OVERLAP: int = int(os.getenv("CHUNK_OVERLAP", "0"))        # no overlap in parent-child RAG (forced reload)

# ── Retrieval ────────────────────────────────────────────────────────────────
TOP_K: int = int(os.getenv("TOP_K", "5"))                 # default number of chunks to retrieve
HYBRID_ALPHA: float = float(os.getenv("HYBRID_ALPHA", "0.7"))      # 0 = pure BM25 sparse, 1 = pure dense semantic

# ── Memory ───────────────────────────────────────────────────────────────────
MEMORY_WINDOW: int = int(os.getenv("MEMORY_WINDOW", "5"))         # number of past conversation turns to include

# ── Upload ───────────────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_MB: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "25"))
_exts = os.getenv("ALLOWED_EXTENSIONS", ".txt,.docx,.pdf")
ALLOWED_EXTENSIONS: set = {ext.strip() for ext in _exts.split(",") if ext.strip()}

# ── Security & Tuning ────────────────────────────────────────────────────────
# Comma-separated list of allowed origins. Use "*" for local dev only.
_origins = os.getenv("ALLOWED_ORIGINS", "*")
ALLOWED_ORIGINS: list[str] = [origin.strip() for origin in _origins.split(",") if origin.strip()]

LLM_TEMPERATURE: float = float(os.getenv("LLM_TEMPERATURE", "0.1"))
LLM_MAX_TOKENS: int = int(os.getenv("LLM_MAX_TOKENS", "2048"))

# ── Rate Limits ──────────────────────────────────────────────────────────────
RATE_LIMIT_QUERIES: str = os.getenv("RATE_LIMIT_QUERIES", "20/minute")
RATE_LIMIT_UPLOADS: str = os.getenv("RATE_LIMIT_UPLOADS", "5/minute")
