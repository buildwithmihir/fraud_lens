"""Shared shaping helpers for the route modules.

Holds the PostgREST `select` strings and the flattening applied to embedded rows,
so the transaction shape returned by GET /transactions and by
GET /users/{id}/history is identical and the frontend can use one adapter.
"""

from __future__ import annotations

from typing import Any

# List shape: every transaction column, the user record, and the transaction's
# transfers. It is deliberately the *whole* case rather than a lean summary --
# dashboard/src/pages/Dashboard.jsx renders the queue, the evidence cards, the
# user panel and the mule-chain graph from this one response, so trimming
# evidence or the user fields here would cost it a request per selected row.
#
# `transfers` is a reverse embed on transfers.linked_transaction_id: PostgREST
# returns each transaction's transfers as a nested array, so the 4 transfer rows
# arrive with the queue instead of in 393 follow-up calls. Rows come back in no
# guaranteed order; the caller sorts by timestamp to recover hop order.
TXN_LIST_SELECT = (
    "id,user_id,timestamp,amount,location,device_id,risk_score,status,"
    "evidence_for,evidence_against,is_new_device,is_new_beneficiary,beneficiary_id,"
    "merchant_category,created_by,"
    "users(id,name,account_created_at,avg_transaction_amount,"
    "typical_locations,known_devices),"
    "transfers(id,from_account,to_account,amount,timestamp)"
)

# Detail shape: all columns (evidence_for/evidence_against included via *) plus
# the full user record for the context panel.
TXN_DETAIL_SELECT = (
    "*,users(id,name,account_created_at,avg_transaction_amount,"
    "typical_locations,known_devices)"
)

# Highest risk first, then newest. `id` is the tiebreaker: select_all() pages with
# Range, and paging over a non-unique sort can drop or repeat rows between pages.
TXN_ORDER = "risk_score.desc.nullslast,timestamp.desc,id.asc"

# Newest first for a single user's history -- it is read as a timeline, not a queue.
HISTORY_ORDER = "timestamp.desc,id.asc"


def flatten_user(row: dict[str, Any], *, keep_nested: bool = False) -> dict[str, Any]:
    """Lift the embedded `users` object into a top-level `user_name`.

    PostgREST returns an embedded to-one relation as a nested object (or null when
    the FK is null). Callers want the name inline; the detail route also keeps the
    full record under `user`.
    """
    user = row.pop("users", None) or {}
    row["user_name"] = user.get("name")
    if keep_nested:
        row["user"] = user or None
    return row
