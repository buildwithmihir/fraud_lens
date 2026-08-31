"""Risk policy administration.

  PUT /risk-policy -- set the action for the band matching a min/max score pair
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from services.supabase_client import SupabaseClient, get_client

router = APIRouter(tags=["admin"])


class RiskPolicyIn(BaseModel):
    """The band is addressed by its (min_score, max_score) pair, not by id.

    Bands are seeded as 0-30, 31-60, 61-85, 86-100. `action` is free text for the
    same reason as `decision` in routes/decisions.py -- the stored values are
    slugs ('allow', 'verify', 'review', 'high_risk') while the dashboard shows
    prose labels, and neither side should be frozen by the other.
    """

    model_config = {"extra": "forbid"}

    min_score: Annotated[float, Field(ge=0, le=100)]
    max_score: Annotated[float, Field(ge=0, le=100)]
    action: Annotated[str, Field(min_length=1, max_length=100)]
    updated_by: Annotated[str, Field(min_length=1, max_length=200)] = "api"

    @model_validator(mode="after")
    def check_band(self):
        if self.min_score > self.max_score:
            raise ValueError(
                f"min_score ({self.min_score}) must not exceed max_score ({self.max_score})"
            )
        return self


def _fmt(value: float) -> str:
    """Render a numeric band edge for a PostgREST filter without a stray '.0'.

    min_score/max_score are `numeric`; sending '0' rather than '0.0' keeps the
    equality filter matching the seeded integer values.
    """
    return str(int(value)) if float(value).is_integer() else str(value)


@router.put("/risk-policy")
async def update_risk_policy(
    body: RiskPolicyIn, db: SupabaseClient = Depends(get_client)
) -> dict:
    """Update `action` for the band whose min/max match exactly.

    Only `action` (plus the audit columns) is written -- the band edges identify
    the row and are never moved by this endpoint, so a typo'd range is a 404
    instead of silently redefining a band.
    """
    band_filter = {
        "min_score": f"eq.{_fmt(body.min_score)}",
        "max_score": f"eq.{_fmt(body.max_score)}",
    }

    updated = await db.update(
        "risk_policy",
        band_filter,
        {
            "action": body.action,
            "updated_by": body.updated_by,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )

    if not updated:
        bands = await db.select(
            "risk_policy", {"select": "min_score,max_score,action", "order": "min_score.asc"}
        )
        available = ", ".join(f"{int(b['min_score'])}-{int(b['max_score'])}" for b in bands)
        raise HTTPException(
            404,
            f"No risk_policy band with min_score={_fmt(body.min_score)} and "
            f"max_score={_fmt(body.max_score)}. Existing bands: {available}.",
        )

    return updated[0]
