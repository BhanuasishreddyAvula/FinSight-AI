"""
FinSight AI — FastAPI Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from api.routes import upload, query, documents, config
from core.limiter import limiter
from core.config import ALLOWED_ORIGINS

app = FastAPI(
    title="FinSight AI",
    description="Financial Document RAG Assistant",
    version="1.0.0",
)

# Register rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Let's get CORS out of the way first. We dynamically pull this from config
# so we don't accidentally leave the doors wide open in production!
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Time to hook up our routers! 
app.include_router(upload.router, prefix="/api", tags=["ingestion"])
app.include_router(query.router, prefix="/api", tags=["query"])
app.include_router(documents.router, prefix="/api", tags=["documents"])
app.include_router(config.router, prefix="/api", tags=["config"])

# Oh, Chrome DevTools always complains about this missing file, so let's just silence it here 🤫
@app.get("/.well-known/appspecific/com.chrome.devtools.json", include_in_schema=False)
async def devtools_json():
    return {}

import os

# Compute paths dynamically relative to main.py
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(CURRENT_DIR)
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")

# Serve the frontend static files natively
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, "js")), name="js")


@app.get("/", include_in_schema=False)
async def serve_frontend():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/favicon.ico", include_in_schema=False)
async def serve_favicon():
    favicon_path = os.path.join(FRONTEND_DIR, "favicon.png")
    if os.path.exists(favicon_path):
        return FileResponse(favicon_path, media_type="image/png")
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), status_code=404)


@app.get("/FinSight AI.png", include_in_schema=False)
@app.get("/FinSight%20AI.png", include_in_schema=False)
async def serve_logo():
    logo_path = os.path.join(FRONTEND_DIR, "FinSight AI.png")
    if os.path.exists(logo_path):
        return FileResponse(logo_path, media_type="image/png")
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), status_code=404)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "FinSight AI"}




