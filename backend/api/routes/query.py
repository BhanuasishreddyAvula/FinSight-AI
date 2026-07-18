"""
query.py — POST /query endpoint with streaming SSE response.
Runs hybrid retrieval + Groq generation, streams the answer token-by-token.
"""
import json
import traceback
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from core.limiter import limiter
from core.config import RATE_LIMIT_QUERIES, COHERE_API_KEY
from api.schemas import QueryRequest
from retrieval.hybrid_retriever import retrieve
from generation.prompt_builder import build_prompt, build_no_context_response
from generation.generator import stream_answer
from generation.memory import get_history, save_turn, get_all_sessions, delete_session
from storage.supabase_client import get_documents_for_session, delete_document_metadata, delete_file
from retrieval.vector_store import delete_document as delete_vector_document

router = APIRouter()


@router.post("/query")
@limiter.limit(lambda: RATE_LIMIT_QUERIES)
async def query_documents(request: Request, body: QueryRequest):
    """
    Ask a question against the uploaded documents.

    Streaming SSE response — the frontend uses ReadableStream to render
    the answer token by token as it arrives from the LLM.

    Flow:
    1. Load conversation history from Supabase (persistent, survives cold starts).
    2. Hybrid retrieval from Pinecone (namespace=session_id).
    3. Build prompt (system + history + chunks + question).
    4. Stream Groq response.
    5. Save completed turn to Supabase.
    """
    session_id = body.session_id
    question = body.question

    # Extract optional custom API keys from request headers
    voyage_key = request.headers.get("x-voyage-key")
    groq_key = request.headers.get("x-groq-key")

    # Step 1: Retrieve conversation history (Supabase-backed)
    raw_history = get_history(session_id)
    
    # Portfolio safety limit: prevent token exhaustion by limiting history to ~2000 words
    history = []
    total_words = 0
    for turn in reversed(raw_history):
        turn_words = len(turn.get("content", "").split())
        if total_words + turn_words > 2000:
            break
        history.insert(0, turn)
        total_words += turn_words

    # Step 2: Hybrid retrieval (Pinecone, namespaced to session)
    try:
        chunks = retrieve(
            query=question,
            session_id=session_id,
            top_k=body.top_k,
            alpha=body.alpha,
            api_key=voyage_key,
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Retrieval failed: {str(e)}")

    # Step 3: Handle no-results case
    if not chunks:
        fallback = build_no_context_response()
        save_turn(session_id, question, fallback)

        async def fallback_stream():
            yield f"data: {json.dumps({'type': 'token', 'data': fallback})}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(fallback_stream(), media_type="text/event-stream")

    # Step 4: Build prompt
    prompt = build_prompt(query=question, retrieved_chunks=chunks, history=history)

    # Step 5: Stream response
    full_answer_parts: list[str] = []

    async def token_stream():
        nonlocal full_answer_parts

        try:
            async for token in stream_answer(prompt, api_key=groq_key):
                full_answer_parts.append(token)
                yield f"data: {json.dumps({'type': 'token', 'data': token})}\n\n"
        except Exception as e:
            traceback.print_exc()
            yield f"data: {json.dumps({'type': 'token', 'data': f'\\n\\n[Generation Error: {str(e)}]'})}\n\n"

        # Save completed turn to Supabase memory
        full_answer = "".join(full_answer_parts)
        try:
            save_turn(session_id, question, full_answer)
        except Exception:
            pass  # Don't fail the stream if memory save fails

        yield "data: [DONE]\n\n"

    return StreamingResponse(token_stream(), media_type="text/event-stream")


@router.get("/query/history")
async def get_chat_history(session_id: str):
    """
    Retrieve conversation history turns for a session from Supabase Postgres.
    """
    try:
        history = get_history(session_id)
        return {"status": "success", "history": history}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load chat history: {str(e)}")


@router.get("/query/sessions")
async def get_sessions():
    """
    Retrieve all user sessions.
    """
    try:
        sessions = get_all_sessions()
        return {"status": "success", "sessions": sessions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load sessions: {str(e)}")


@router.delete("/query/sessions/{session_id}")
async def delete_user_session(session_id: str):
    """
    Delete a specific conversation session, all its logs, and its documents.
    """
    try:
        docs = get_documents_for_session(session_id)
        for doc in docs:
            doc_id = doc.get("doc_id")
            storage_path = doc.get("storage_path")
            
            try:
                delete_vector_document(doc_id=doc_id, session_id=session_id)
            except Exception as e:
                print(f"Failed to delete vectors for {doc_id}: {e}")
                
            if storage_path:
                try:
                    delete_file(storage_path)
                except Exception as e:
                    print(f"Failed to delete file {storage_path}: {e}")
                    
            try:
                delete_document_metadata(doc_id)
            except Exception as e:
                print(f"Failed to delete metadata for {doc_id}: {e}")

        delete_session(session_id)
        return {"status": "success", "message": f"Session {session_id} and its sources deleted successfully."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {str(e)}")
