import re
from pydantic import BaseModel, Field, field_validator
from typing import Optional

ID_PATTERN = re.compile(r"^[a-zA-Z0-9_\-]+$")


def validate_id_string(value: str, field_name: str = "ID") -> str:
    """Validate that an ID string is safe, non-empty, and bounded."""
    if not value or not isinstance(value, str):
        raise ValueError(f"{field_name} must be a non-empty string.")
    val = value.strip()
    if len(val) > 128:
        raise ValueError(f"{field_name} exceeds maximum length of 128 characters.")
    if not ID_PATTERN.match(val):
        raise ValueError(f"{field_name} contains invalid characters.")
    return val


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
    session_id: str = Field(..., min_length=1, max_length=128, description="UUID identifying the user's session")
    top_k: int = Field(default=5, ge=1, le=20)
    alpha: float = Field(default=0.7, ge=0.0, le=1.0)

    @field_validator("session_id")

    @classmethod
    def validate_session(cls, v: str) -> str:
        return validate_id_string(v, "session_id")


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
