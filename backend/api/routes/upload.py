"""
upload.py — POST /upload endpoint.
Accepts a file + session_id, runs the full ingestion pipeline.
"""
import uuid
import tempfile
import os
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from api.schemas import UploadResponse, validate_id_string
from ingestion.file_router import route_file
from ingestion.embedder import embed_texts
from retrieval.vector_store import upsert_chunks, verify_document_indexed, delete_document
from storage.supabase_client import upload_file, save_document_metadata, delete_file, save_parent_chunks, delete_document_metadata
from core.config import ALLOWED_EXTENSIONS, MAX_UPLOAD_SIZE_MB, RATE_LIMIT_UPLOADS
from core.limiter import limiter

router = APIRouter()

MIME_MAP = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
}


def _rollback_ingestion(doc_id: str, session_id: str, storage_path: str):
    """
    Robust rollback for failed ingestion steps.
    Cleans up raw Storage file, Pinecone vectors, and Postgres metadata/parents.
    """
    if storage_path:
        try:
            delete_file(storage_path)
        except Exception as e:
            print(f"[Rollback] Storage deletion failed for {storage_path}: {e}")

    if doc_id and session_id:
        try:
            delete_document(doc_id=doc_id, session_id=session_id)
        except Exception as e:
            print(f"[Rollback] Vector deletion failed for {doc_id}: {e}")

    if doc_id:
        try:
            delete_document_metadata(doc_id)
        except Exception as e:
            print(f"[Rollback] Metadata deletion failed for {doc_id}: {e}")


@router.post("/upload", response_model=UploadResponse)
@limiter.limit(lambda: RATE_LIMIT_UPLOADS)
def upload_document(
    request: Request,
    file: UploadFile = File(...),
    session_id: str = Form(...),
):
    """
    Upload and ingest a financial document.

    1. Validates session ID, file type, and size.
    2. Saves raw file to Supabase Storage.
    3. Parses and chunks the document.
    4. Embeds chunks (dense vectors).
    5. Upserts to Pinecone under namespace=session_id.
    6. Saves document metadata to Supabase Postgres.
    """
    try:
        session_id = validate_id_string(session_id, "session_id")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    # Validate extension
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Read file bytes synchronously so FastAPI runs this route in an external threadpool
    file_bytes = file.file.read()
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_UPLOAD_SIZE_MB:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({size_mb:.1f}MB). Maximum: {MAX_UPLOAD_SIZE_MB}MB",
        )

    # Generate unique document ID
    doc_id = str(uuid.uuid4())
    storage_path = f"{session_id}/{doc_id}{ext}"

    # Save raw file to Supabase Storage
    try:
        upload_file(file_bytes, storage_path, content_type=MIME_MAP.get(ext, "application/octet-stream"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {str(e)}")

    tmp_path = None
    # Write to a temp file for parsers (they work with file paths)
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        # Parse + chunk using v2 pipeline (blocks → parents → children)
        chunks, parents = route_file(tmp_path, filename=file.filename, doc_id=doc_id)

        if not chunks:
            raise HTTPException(status_code=422, detail="Could not extract any text from this file.")

        # Embed (dense vectors)
        texts = [c["text"] for c in chunks]
        
        # Get custom API key if provided
        voyage_key = request.headers.get("x-voyage-key")
        dense_vectors = embed_texts(texts, api_key=voyage_key)

        # Upsert to Pinecone (dense + sparse, namespaced)
        upserted = upsert_chunks(chunks, dense_vectors, session_id=session_id, doc_id=doc_id)

        # Verification Loop: Block until Pinecone finishes indexing
        verify_document_indexed(doc_id, session_id, upserted)

        # Save metadata to Supabase Postgres
        doc_type = ext.lstrip(".")
        save_document_metadata(
            doc_id=doc_id,
            session_id=session_id,
            filename=file.filename,
            doc_type=doc_type,
            chunk_count=upserted,
            storage_path=storage_path,
        )

        # Save parent chunks to Supabase Document Store
        save_parent_chunks(parents, doc_id)

    except HTTPException as he:
        _rollback_ingestion(doc_id, session_id, storage_path)
        raise he
    except Exception as e:
        _rollback_ingestion(doc_id, session_id, storage_path)
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)  # Clean up temp file

    return UploadResponse(
        doc_id=doc_id,
        filename=file.filename,
        doc_type=doc_type,
        chunks_created=upserted,
        session_id=session_id,
    )
