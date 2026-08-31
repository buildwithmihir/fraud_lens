"""User history.

  GET /users/{id}/history -- that user's past transactions, newest first
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from routes.common import HISTORY_ORDER, TXN_LIST_SELECT, flatten_user
from services.supabase_client import SupabaseClient, get_client

router = APIRouter(tags=["users"])


@router.get("/users/{user_id}/history")
async def user_history(
    user_id: UUID, db: SupabaseClient = Depends(get_client)
) -> list[dict]:
    """One user's transactions, newest first, in the same shape as GET /transactions.

    The user is looked up first so an id that matches nobody is a 404 rather than
    an empty list -- otherwise a typo'd id is indistinguishable from a real user
    who has no transactions.
    """
    users = await db.select(
        "users", {"select": "id", "id": f"eq.{user_id}", "limit": "1"}
    )
    if not users:
        raise HTTPException(404, f"No user with id {user_id}")

    rows = await db.select_all(
        "transactions",
        {"select": TXN_LIST_SELECT, "user_id": f"eq.{user_id}", "order": HISTORY_ORDER},
    )
    return [flatten_user(r, keep_nested=True) for r in rows]
