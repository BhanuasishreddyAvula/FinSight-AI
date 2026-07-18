"""
schemas.py — Pydantic request/response models for all API endpoints.
"""
from pydantic import BaseModel, Field
from typing import Optional


# ── Upload ────────────────────────────────────────────────────────────────────

class UploadResponse(BaseModel):
    doc_id: str
    filename: str
    doc_type: str
    chunks_created: int
    session_id: str
    status: str = "success"


# ── Query ─────────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(..., description="UUID identifying the user's session")
    top_k: int = Field(default=5, ge=1, le=20)
    alpha: float = Field(default=0.7, ge=0.0, le=1.0)


# ── Documents ─────────────────────────────────────────────────────────────────

class DocumentInfo(BaseModel):
    doc_id: str
    filename: str
    doc_type: str
    chunk_count: int
    uploaded_at: str


class DocumentListResponse(BaseModel):
    documents: list[DocumentInfo]
    session_id: str


class DeleteResponse(BaseModel):
    status: str
    message: str
