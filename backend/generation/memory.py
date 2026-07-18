"""
memory.py — Supabase-backed persistent conversation history.

Architecture decision:
- Conversation history is stored in a Supabase Postgres table, NOT in RAM.
- This means memory persists across server restarts / Render cold starts.
- The session_id in every API call maps to a row group in this table.
- Multiple workers can safely read/write without state conflicts.

Supabase table schema (create this in the Supabase SQL editor):
    CREATE TABLE conversations (
        id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        session_id  TEXT NOT NULL,
        role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        content     TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX idx_conversations_session_id ON conversations(session_id);
"""
from storage.supabase_client import get_supabase_client
from core.config import MEMORY_WINDOW


def get_history(session_id: str) -> list[dict]:
    """
    Retrieve the last N conversation turns for a session.

    Returns:
        List of {role, content} dicts ordered oldest → newest.
    """
    client = get_supabase_client()
    result = (
        client.table("conversations")
        .select("role, content, created_at")
        .eq("session_id", session_id)
        .order("created_at", desc=True)
        .limit(MEMORY_WINDOW * 2)  # *2 because each turn = 1 user + 1 assistant
        .execute()
    )
    rows = result.data or []
    
    # Sort chronologically (oldest first).
    # If timestamps are identical (because they were inserted in a batch),
    # guarantee that 'user' role comes before 'assistant'.
    def sort_key(row):
        role_priority = 0 if row['role'] == 'user' else 1
        return (row['created_at'], role_priority)
        
    rows.sort(key=sort_key)
    
    return [{"role": row["role"], "content": row["content"]} for row in rows]


def save_turn(session_id: str, user_message: str, assistant_message: str) -> None:
    """
    Persist one full conversation turn (user + assistant) to Supabase.

    Args:
        session_id: The session to append the turn to.
        user_message: The user's question.
        assistant_message: The full assistant response (after streaming completes).
    """
    client = get_supabase_client()
    client.table("conversations").insert([
        {"session_id": session_id, "role": "user", "content": user_message},
        {"session_id": session_id, "role": "assistant", "content": assistant_message},
    ]).execute()


def get_all_sessions() -> list[dict]:
    """
    Retrieve a list of all distinct sessions for the user, 
    sorted by most recent activity.
    """
    client = get_supabase_client()
    # Fetch all user messages to determine sessions and preview content
    result = (
        client.table("conversations")
        .select("session_id, content, created_at")
        .eq("role", "user")
        .order("created_at", desc=True)
        .execute()
    )
    
    rows = result.data or []
    sessions_map = {}
    
    # Since they are ordered by created_at DESC, the first time we see 
    # a session_id, it is the most recent message for that session.
    # We will use the oldest message in a session as the "title/preview"
    # Wait, usually the FIRST question asked is the best title for a session!
    # To get the first question, we can iterate in reverse or just keep track.
    
    for row in reversed(rows):
        sid = row["session_id"]
        if sid not in sessions_map:
            # First time we see it in reversed order (oldest) = first message
            sessions_map[sid] = {
                "session_id": sid,
                "preview": row["content"][:60] + "..." if len(row["content"]) > 60 else row["content"],
                "created_at": row["created_at"] # We'll update this to the latest
            }
        else:
            # Update the created_at to the latest we see
            sessions_map[sid]["created_at"] = row["created_at"]
            
    # Sort the resulting sessions by latest activity
    sorted_sessions = sorted(sessions_map.values(), key=lambda x: x["created_at"], reverse=True)
    return sorted_sessions


def delete_session(session_id: str) -> None:
    """
    Delete conversation history for a given session from Supabase.
    """
    client = get_supabase_client()
    client.table("conversations").delete().eq("session_id", session_id).execute()
