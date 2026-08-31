"""FraudLens backend.

Five endpoints, all backed by Supabase through services/supabase_client.py:

  GET  /transactions              every transaction + the user's name
  GET  /transactions/{id}         one transaction, all columns + evidence + transfers
  GET  /users/{id}/history        that user's past transactions
  POST /decisions                 record an analyst decision
  PUT  /risk-policy               set the action for one min/max score band

Run from the backend/ directory:

    uvicorn main:app --reload --port 8000

The dashboard (Vite, localhost:5173) still reads Supabase directly with the anon
key; CORS is open to it so it can move onto this API endpoint by endpoint.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routes import admin, decisions, transactions, users
from services.supabase_client import (
    SupabaseError,
    close_client,
    init_client,
    key_role,
    load_credentials,
)

log = logging.getLogger("fraudlens")

# Vite dev server. Both spellings are listed because a browser sends whichever
# host the user typed, and CORS origins match as exact strings.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

# PostgREST/Postgres error code -> HTTP status. Anything unlisted becomes a 502:
# the request reached us fine, the upstream store is what failed.
ERROR_STATUS = {
    "23503": 409,  # foreign key violation (routes may narrow this to 404)
    "23505": 409,  # unique violation
    "23514": 400,  # check constraint violation
    "22P02": 400,  # invalid text representation (malformed uuid/number)
    "42501": 403,  # RLS refused the operation
    "PGRST116": 404,  # single-row request matched no rows
    "PGRST205": 503,  # table missing from the schema cache
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Open one pooled Supabase client for the app's lifetime."""
    url, key = load_credentials()
    init_client()
    log.info("Supabase %s (key role=%s)", url, key_role(key))
    try:
        yield
    finally:
        await close_client()


app = FastAPI(
    title="FraudLens API",
    version="0.1.0",
    description="Read/write API over the FraudLens Supabase tables.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(SupabaseError)
async def supabase_error_handler(request: Request, err: SupabaseError) -> JSONResponse:
    """Turn an upstream failure into a typed response instead of a bare 500.

    The upstream message is passed through because this API is not public --
    it serves the analyst dashboard, where the Postgres detail is the useful part
    of a failed write.
    """
    status = ERROR_STATUS.get(err.code or "", 502)
    log.warning("Supabase error on %s %s: %s %s",
                request.method, request.url.path, err.code, err.message)
    return JSONResponse(
        status_code=status,
        content={"detail": err.message, "code": err.code, "hint": err.details},
    )


app.include_router(transactions.router)
app.include_router(users.router)
app.include_router(decisions.router)
app.include_router(admin.router)
