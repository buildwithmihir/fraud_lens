"""Analyst decisions.

  GET  /decisions -- every recorded decision, newest first, joined for display
  POST /decisions -- record analyst_name, transaction_id, decision, reason
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from services.supabase_client import SupabaseClient, SupabaseError, get_client

router = APIRouter(tags=["decisions"])

# The decision plus enough of its transaction to render an audit row without a
# second request. `transactions(...)` follows decisions.transaction_id, and the
# nested `users(name)` follows transactions.user_id from there.
DECISION_SELECT = "*,transactions(amount,location,users(name))"

# Newest first -- an audit trail is read from the top. `id` breaks ties so
# select_all()'s Range paging cannot drop or repeat a row when two decisions
# share a timestamp.
DECISION_ORDER = "decided_at.desc,id.asc"


def flatten_decision(row: dict[str, Any]) -> dict[str, Any]:
    """Lift the joined transaction fields to the top level for display.

    transaction_id is nullable, and a decision could outlive its transaction, so
    a missing embed yields nulls rather than raising -- the audit row still
    renders, just without the amount/location/name.
    """
    txn = row.pop("transactions", None) or {}
    user = txn.get("users") or {}
    row["amount"] = txn.get("amount")
    row["location"] = txn.get("location")
    row["user_name"] = user.get("name")
    return row


class DecisionIn(BaseModel):
    """Required fields mirror the table's NOT NULLs; `reason` is nullable there.

    `decision` is free text rather than an enum: the column has no CHECK
    constraint, and the dashboard's labels ('Confirm fraud', 'Mark legitimate',
    'Escalate') are UI copy that should be able to change without a backend
    release. If a constraint is added later, Postgres rejects the write and the
    23514 mapping below turns it into a 400.
    """

    model_config = {"extra": "forbid"}

    analyst_name: Annotated[str, Field(min_length=1, max_length=200)]
    transaction_id: UUID
    decision: Annotated[str, Field(min_length=1, max_length=100)]
    reason: Annotated[str | None, Field(max_length=2000)] = None


@router.get("/decisions")
async def list_decisions(db: SupabaseClient = Depends(get_client)) -> list[dict]:
    """Every decision, newest first, each carrying its transaction's display fields.

    Unfiltered on purpose: the audit trail shows the whole log. select_all() pages
    past PostgREST's 1000-row cap, so the endpoint keeps returning everything as
    the table grows rather than silently stopping at the first page.
    """
    rows = await db.select_all(
        "decisions", {"select": DECISION_SELECT, "order": DECISION_ORDER}
    )
    return [flatten_decision(r) for r in rows]


@router.post("/decisions", status_code=201)
async def create_decision(
    body: DecisionIn, db: SupabaseClient = Depends(get_client)
) -> dict:
    """Insert one decision and return the stored row.

    `id` and `decided_at` are generated here because the table declares both NOT
    NULL with no default (they appear in PostgREST's `required` list), so an
    insert that omits them fails. Sending them explicitly is correct either way.
    """
    row = {
        "id": str(uuid4()),
        "transaction_id": str(body.transaction_id),
        "analyst_name": body.analyst_name,
        "decision": body.decision,
        "reason": body.reason,
        "decided_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        inserted = await db.insert("decisions", [row])
    except SupabaseError as err:
        # 23503: transaction_id has no matching transactions.id. That is a bad
        # reference in the request, not a server fault.
        if err.code == "23503":
            raise HTTPException(
                404,
                f"No transaction with id {body.transaction_id} — cannot record a "
                "decision against it.",
            ) from err
        raise

    return inserted[0]
