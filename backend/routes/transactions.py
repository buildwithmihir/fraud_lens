"""Transaction reads.

  GET /transactions       -- every transaction, joined with the user's name
  GET /transactions/{id}  -- one transaction, all columns + evidence + transfers
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from routes.common import TXN_DETAIL_SELECT, TXN_LIST_SELECT, TXN_ORDER, flatten_user
from services.supabase_client import SupabaseClient, SupabaseError, get_client

router = APIRouter(tags=["transactions"])


@router.get("/transactions")
async def list_transactions(db: SupabaseClient = Depends(get_client)) -> list[dict]:
    """All transactions, highest risk first, each with `user_name` from the join.

    Read through select_all(), which pages past PostgREST's 1000-row cap -- the
    table holds 393 rows today, so this is one request, but it stays correct as
    the table grows.
    """
    rows = await db.select_all(
        "transactions", {"select": TXN_LIST_SELECT, "order": TXN_ORDER}
    )
    return [flatten_user(r, keep_nested=True) for r in rows]


@router.get("/transactions/{transaction_id}")
async def get_transaction(
    transaction_id: UUID, db: SupabaseClient = Depends(get_client)
) -> dict:
    """One transaction with every column, plus its user and any linked transfers.

    `transfers` is the mule-chain trail: rows in `transfers` whose
    linked_transaction_id points here, oldest first (the hop order -- the live
    schema has no hop column, see model/seed_supabase.py MAPPING_NOTES). It is an
    empty list when the transaction has none, which is the common case: only 4 of
    393 transactions carry transfers.
    """
    rows = await db.select(
        "transactions",
        {"select": TXN_DETAIL_SELECT, "id": f"eq.{transaction_id}", "limit": "1"},
    )
    if not rows:
        raise HTTPException(404, f"No transaction with id {transaction_id}")

    txn = flatten_user(rows[0], keep_nested=True)
    txn["transfers"] = await db.select(
        "transfers",
        {
            "select": "id,from_account,to_account,amount,timestamp,linked_transaction_id",
            "linked_transaction_id": f"eq.{transaction_id}",
            "order": "timestamp.asc,id.asc",
        },
    )
    return txn
from pydantic import BaseModel, Field
from typing import Annotated
from uuid import uuid4
from datetime import datetime, timezone

class TransactionCreate(BaseModel):
    model_config = {"extra": "forbid"}

    user_name: Annotated[str, Field(min_length=1, max_length=200)]
    amount: Annotated[float, Field(gt=0)]
    location: Annotated[str, Field(min_length=1, max_length=200)]
    new_device: bool = False
    new_beneficiary: bool = False


# Canonical rulebook, shared with model/score_transaction.py and
# dashboard/src/lib/risk.js. Keep these in lockstep with both files.
AMOUNT_MULTIPLE = 10  # "large" = more than 10x the user's average
HOUR_START, HOUR_END = 6, 23  # normal activity window, 06:00-23:00 UTC
FLAG_THRESHOLD = 70  # scorer default; the live value is read from the settings table
WEIGHTS = {"amount": 28, "device": 24, "location": 24, "hour": 19}


def score_transaction(
    *,
    amount: float,
    avg_amount: float | None,
    location: str,
    typical_locations: list[str],
    new_device: bool,
    known_devices: list[str],
    timestamp: datetime,
    flag_threshold: float = FLAG_THRESHOLD,
) -> dict:
    """Score a transaction with the canonical rules (mirrors model/score_transaction.py).

    Four rules with weights 28/24/24/19, score = sum of fired weights capped at
    100, status = flagged when the score exceeds the live threshold. The admin
    create form sends `new_device` as a boolean rather than a device id, so that
    flag stands in for the model's "device not in known_devices" check. The hour
    rule is evaluated against the transaction's timestamp (now, for a new row).

    The evidence_for strings deliberately keep the substrings
    dashboard/src/lib/risk.js firedFromEvidence() keys on: "x user average",
    "unrecognized device", "new location", "outside the".
    """
    avg = float(avg_amount or 0)
    devices = known_devices or []
    locations = typical_locations or []
    utc_ts = timestamp.astimezone(timezone.utc)
    hour, clock = utc_ts.hour, utc_ts.strftime("%H:%M")
    ratio = amount / avg if avg else float("inf")

    checks = [
        ("amount", amount > AMOUNT_MULTIPLE * avg,
         f"Amount {ratio:.0f}x user average ({amount:,.2f} vs {avg:,.2f} typical)",
         f"Amount consistent with user average ({ratio:.1f}x of {avg:,.2f})"),
        ("device", new_device,
         f"Unrecognized device, not among the user's {len(devices)} known devices",
         "Device matches a device the user has used before"),
        ("location", location not in locations,
         f"New location {location}, outside usual activity in {', '.join(locations)}",
         f"Location {location} matches user history"),
        ("hour", not (HOUR_START <= hour < HOUR_END),
         f"Transaction at {clock} UTC, outside the {HOUR_START:02d}:00-{HOUR_END:02d}:00 window",
         f"Transaction at {clock} UTC, within normal activity hours"),
    ]

    risk, evidence_for, evidence_against = 0, [], []
    for name, fired, why_for, why_against in checks:
        if fired:
            risk += WEIGHTS[name]
            evidence_for.append(why_for)
        else:
            evidence_against.append(why_against)

    risk = min(risk, 100)
    return {
        "risk_score": risk,
        "status": "flagged" if risk > flag_threshold else "normal",
        "evidence_for": evidence_for,
        "evidence_against": evidence_against,
    }


@router.post("/transactions", status_code=201)
async def create_transaction(
    body: TransactionCreate, db: SupabaseClient = Depends(get_client)
) -> dict:
    """Admin demo tool: submit a transaction, score it with the same rules
    used elsewhere, and insert it so it appears in the live feed."""

    users = await db.select_all("users", {"select": "*", "name": f"eq.{body.user_name}"})
    if not users:
        raise HTTPException(404, f"No user named {body.user_name}")
    user = users[0]

    # The live flag threshold lives in the settings table -- the same source the
    # dashboard reads. Fall back to the scorer default if it cannot be read, so a
    # settings hiccup never blocks an insert.
    flag_threshold = FLAG_THRESHOLD
    try:
        rows = await db.select(
            "settings", {"select": "value", "key": "eq.flag_threshold", "limit": "1"}
        )
        if rows:
            flag_threshold = int(rows[0]["value"])
    except (SupabaseError, TypeError, ValueError, KeyError, IndexError):
        pass

    now = datetime.now(timezone.utc)
    scoring = score_transaction(
        amount=body.amount,
        avg_amount=user.get("avg_transaction_amount"),
        location=body.location,
        typical_locations=user.get("typical_locations") or [],
        new_device=body.new_device,
        known_devices=user.get("known_devices") or [],
        timestamp=now,
        flag_threshold=flag_threshold,
    )

    row = {
        "id": str(uuid4()),
        "user_id": user["id"],
        "amount": body.amount,
        "timestamp": now.isoformat(),
        "location": body.location,
        "is_new_device": body.new_device,
        "is_new_beneficiary": body.new_beneficiary,
        "created_by": "admin_test",
        **scoring,
    }

    inserted = await db.insert("transactions", [row])
    return inserted[0]