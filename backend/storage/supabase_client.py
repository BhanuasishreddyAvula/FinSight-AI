"""
supabase_client.py — Supabase client for:
1. Raw file storage (Supabase Storage bucket)
2. Document metadata persistence (Supabase Postgres)
3. Conversation history read/write (used by memory.py)

Supabase tables required (create via SQL Editor or apply_migration):

    -- Document metadata
    CREATE TABLE documents (
        id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        doc_id      TEXT NOT NULL UNIQUE,
        session_id  TEXT NOT NULL,
        filename    TEXT NOT NULL,
        doc_type    TEXT NOT NULL,
        chunk_count INT NOT NULL DEFAULT 0,
        storage_path TEXT,
        uploaded_at TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX idx_documents_session_id ON documents(session_id);

    -- Conversation history (also referenced in memory.py)
    CREATE TABLE conversations (
        id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        session_id  TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content     TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX idx_conversations_session_id ON conversations(session_id);
"""
from supabase import create_client, Client
from core.config import SUPABASE_URL, SUPABASE_KEY, SUPABASE_BUCKET


_client = None


def get_supabase_client() -> Client:
    """Return a cached Supabase client instance to ensure fast queries and thread safety."""
    global _client
    if _client is None:
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _client


# ── File Storage ──────────────────────────────────────────────────────────────

def upload_file(file_bytes: bytes, storage_path: str, content_type: str = "application/octet-stream") -> str:
    """
    Upload a raw file to Supabase Storage.

    Args:
        file_bytes: Raw file content.
        storage_path: Path within the bucket (e.g. 'session123/report.pdf').
        content_type: MIME type of the file.

    Returns:
        Public URL of the uploaded file.
    """
    client = get_supabase_client()
    client.storage.from_(SUPABASE_BUCKET).upload(
        path=storage_path,
        file=file_bytes,
        file_options={"content-type": content_type},
    )
    url = client.storage.from_(SUPABASE_BUCKET).get_public_url(storage_path)
    return url


def delete_file(storage_path: str) -> None:
    """Remove a file from Supabase Storage."""
    client = get_supabase_client()
    client.storage.from_(SUPABASE_BUCKET).remove([storage_path])


# ── Document Metadata ─────────────────────────────────────────────────────────

def save_document_metadata(
    doc_id: str,
    session_id: str,
    filename: str,
    doc_type: str,
    chunk_count: int,
    storage_path: str,
) -> None:
    """Persist document metadata to Supabase Postgres."""
    client = get_supabase_client()
    client.table("documents").insert({
        "doc_id": doc_id,
        "session_id": session_id,
        "filename": filename,
        "doc_type": doc_type,
        "chunk_count": chunk_count,
        "storage_path": storage_path,
    }).execute()


def get_documents_for_session(session_id: str) -> list[dict]:
    """Retrieve all document metadata for a session."""
    client = get_supabase_client()
    result = (
        client.table("documents")
        .select("doc_id, filename, doc_type, chunk_count, uploaded_at")
        .eq("session_id", session_id)
        .order("uploaded_at", desc=True)
        .execute()
    )
    return result.data or []


def delete_document_metadata(doc_id: str) -> None:
    """Remove a document's metadata row."""
    client = get_supabase_client()
    client.table("documents").delete().eq("doc_id", doc_id).execute()

def get_document_metadata(doc_id: str) -> dict | None:
    """Get metadata for a specific document."""
    client = get_supabase_client()
    result = client.table("documents").select("*").eq("doc_id", doc_id).execute()
    return result.data[0] if result.data else None


# ── Parent Chunks (Supabase Document Store) ───────────────────────────────────

def save_parent_chunks(parents: list, doc_id: str) -> None:
    """Bulk insert ParentChunks into Supabase."""
    if not parents:
        return
    
    client = get_supabase_client()
    
    # We must format the data for Supabase
    rows = []
    for p in parents:
        rows.append({
            "parent_id": p.parent_id,
            "doc_id": doc_id,
            "heading": p.heading,
            "section_path": " > ".join(p.section_path) if p.section_path else "",
            "text": p.text
        })
    
    # Insert in batches of 100 to avoid request size limits
    batch_size = 100
    for i in range(0, len(rows), batch_size):
        client.table("parent_chunks").insert(rows[i:i+batch_size]).execute()


def fetch_parents(parent_ids: list[str]) -> dict[str, str]:
    """
    Bulk fetch parent texts by their IDs.
    Returns a dictionary mapping parent_id -> text.
    """
    if not parent_ids:
        return {}

    client = get_supabase_client()
    
    # Supabase .in_() query for lightning fast bulk fetch
    result = (
        client.table("parent_chunks")
        .select("parent_id, text")
        .in_("parent_id", parent_ids)
        .execute()
    )
    
    if not result.data:
        return {}
        
    return {row["parent_id"]: row["text"] for row in result.data}
