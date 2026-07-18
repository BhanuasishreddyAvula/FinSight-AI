from fastapi import APIRouter
from core.config import TOP_K, HYBRID_ALPHA, MAX_UPLOAD_SIZE_MB, ALLOWED_EXTENSIONS

router = APIRouter()

@router.get("/config")
async def get_config():
    """
    Exposes configuration details to the frontend dynamically.
    Allows the UI to use environment settings (e.g. upload file size limits).
    """
    return {
        "default_top_k": TOP_K,
        "default_alpha": HYBRID_ALPHA,
        "max_upload_size_mb": MAX_UPLOAD_SIZE_MB,
        "allowed_extensions": list(ALLOWED_EXTENSIONS)
    }
