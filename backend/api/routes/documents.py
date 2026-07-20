"""
documents.py — Document management endpoints.
"""
from fastapi import APIRouter, HTTPException
from api.schemas import DocumentListResponse, DocumentInfo, DeleteResponse, validate_id_string
from storage.supabase_client import get_documents_for_session, delete_document_metadata, delete_file
from retrieval.vector_store import delete_document

router = APIRouter()


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(session_id: str):
    """
    List all documents uploaded in a session.
    Returns metadata from Supabase Postgres.
    """
    try:
        session_id = validate_id_string(session_id, "session_id")
        docs = get_documents_for_session(session_id)
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return DocumentListResponse(
        documents=[
            DocumentInfo(
                doc_id=d["doc_id"],
                filename=d["filename"],
                doc_type=d["doc_type"],
                chunk_count=d["chunk_count"],
                uploaded_at=str(d.get("uploaded_at", "")),
            )
            for d in docs
        ],
        session_id=session_id,
    )


@router.delete("/documents/{doc_id}", response_model=DeleteResponse)
def delete_document_endpoint(doc_id: str, session_id: str):
    """
    Delete a document: removes vectors from Pinecone + file from Supabase Storage
    + metadata row from Supabase Postgres.
    """
    try:
        doc_id = validate_id_string(doc_id, "doc_id")
        session_id = validate_id_string(session_id, "session_id")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    errors = []

    # 1. Delete vectors from Pinecone (namespace=session_id)
    try:
        delete_document(doc_id=doc_id, session_id=session_id)
    except Exception as e:
        errors.append(f"Pinecone deletion failed: {str(e)}")

    # 2. Get storage_path before deleting metadata
    try:
        from storage.supabase_client import get_document_metadata
        meta = get_document_metadata(doc_id)
        storage_path = meta.get("storage_path") if meta else None
    except Exception:
        storage_path = None

    # 3. Delete file from Supabase Storage (if path is known)
    if storage_path:
        try:
            delete_file(storage_path)
        except Exception as e:
            errors.append(f"Storage deletion failed: {str(e)}")

    # 4. Delete metadata row from Supabase Postgres
    try:
        delete_document_metadata(doc_id)
    except Exception as e:
        errors.append(f"Metadata deletion failed: {str(e)}")

    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))

    return DeleteResponse(status="success", message=f"Document {doc_id} deleted successfully.")


@router.get("/documents/{doc_id}/chunks")
def get_document_chunks(doc_id: str, session_id: str):
    """
    Fetch all chunks for a document from Pinecone for diagnostic preview.
    """
    try:
        doc_id = validate_id_string(doc_id, "doc_id")
        session_id = validate_id_string(session_id, "session_id")
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))

    try:
        from storage.supabase_client import get_document_metadata
        from retrieval.vector_store import fetch_document_chunks
        
        # 1. Get metadata to know how many chunks exist
        meta = get_document_metadata(doc_id)
        if not meta:
            raise HTTPException(status_code=404, detail="Document metadata not found")
            
        chunk_count = meta.get("chunk_count", 0)
        if chunk_count == 0:
            return {"status": "success", "chunks": []}
            
        # 2. Fetch chunks from Pinecone
        chunks = fetch_document_chunks(doc_id, chunk_count, session_id)
        
        # Sort by chunk index to ensure chronological order
        chunks.sort(key=lambda x: x["chunk_index"])
        
        return {"status": "success", "chunks": chunks}
        
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch chunks: {str(e)}")
