"""Supabase (PostgREST) connection for the backend.

Talks to the REST API over httpx rather than using the `supabase` SDK, matching
model/seed_supabase.py so there is one HTTP story in the repo.

Credentials are read, never written, with this precedence:
  1. env vars SUPABASE_URL / SUPABASE_KEY
  2. backend/.env    -> SUPABASE_URL, SUPABASE_KEY
  3. dashboard/.env  -> VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

backend/.env currently holds only SUPABASE_KEY (a service_role key), so the URL
falls through to dashboard/.env. That is why the URL and the key resolve
independently instead of as a pair.

The service_role key bypasses RLS, so this module is the trust boundary: it must
only ever be reached through the handlers in backend/routes/, never proxied
straight to a caller.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent.parent

# PostgREST caps a single response at `max-rows` (1000 by default on Supabase).
# select_all() pages at this size so a table growing past the cap widens the read
# instead of silently truncating it.
PAGE = 1000


class SupabaseError(Exception):
    """A PostgREST error, carrying enough to map onto an HTTP response.

    `code` is the Postgres/PostgREST error code (e.g. '23503' FK violation,
    '42501' RLS refusal, '22P02' malformed input) which the routes use to choose
    a status code instead of blanket-500ing.
    """

    def __init__(self, status_code: int, code: str | None, message: str,
                 details: str | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details


def load_credentials() -> tuple[str, str]:
    """Resolve (url, key). Raises RuntimeError if either is missing."""
    backend = dotenv_values(ROOT / "backend" / ".env")
    dash = dotenv_values(ROOT / "dashboard" / ".env")

    url = (os.environ.get("SUPABASE_URL") or backend.get("SUPABASE_URL")
           or dash.get("VITE_SUPABASE_URL"))
    key = (os.environ.get("SUPABASE_KEY") or backend.get("SUPABASE_KEY")
           or dash.get("VITE_SUPABASE_ANON_KEY"))

    if not url or not key:
        missing = "SUPABASE_URL" if not url else "SUPABASE_KEY"
        raise RuntimeError(
            f"{missing} not found in env vars, backend/.env, or dashboard/.env."
        )
    return url.rstrip("/"), key


def key_role(key: str) -> str:
    """Best-effort JWT role claim, for the startup log. Never returns the key."""
    try:
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("role", "unknown")
    except Exception:
        return "service_role" if key.startswith("sb_secret_") else "unknown"


class SupabaseClient:
    """Thin async PostgREST wrapper: select / insert / update.

    One AsyncClient is held for the app's lifetime so connections are pooled
    across requests; the lifespan handler in main.py opens and closes it.
    """

    def __init__(self, url: str, key: str, timeout: float = 30.0):
        self.url = url
        self.key = key
        self._http = httpx.AsyncClient(
            base_url=f"{url}/rest/v1",
            timeout=timeout,
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    @staticmethod
    def _raise(response: httpx.Response) -> None:
        """Translate a PostgREST error body into SupabaseError."""
        ctype = response.headers.get("content-type", "")
        body: Any = response.json() if ctype.startswith("application/json") else response.text
        if isinstance(body, dict):
            raise SupabaseError(
                response.status_code, body.get("code"),
                body.get("message") or "Supabase request failed",
                body.get("details"),
            )
        raise SupabaseError(response.status_code, None, str(body)[:500])

    async def select(self, table: str, params: dict[str, str] | None = None,
                     headers: dict[str, str] | None = None) -> list[dict]:
        """One GET. Use select_all() when the row count could exceed PAGE."""
        r = await self._http.get(table, params=params or {}, headers=headers or {})
        if r.status_code >= 400:
            self._raise(r)
        return r.json()

    async def select_all(self, table: str, params: dict[str, str] | None = None) -> list[dict]:
        """GET every row, paging with Range until the result set is exhausted.

        Requires a stable sort for correct paging, so callers pass `order`; an
        unordered PostgREST read has no guaranteed row order between pages.

        Paging is driven by the total in the Content-Range header and advanced by
        the rows actually received, never by the requested page size. Those differ
        whenever the server's own `max-rows` is smaller than PAGE, and treating a
        short page as "the end" would then silently truncate the read.
        """
        rows: list[dict] = []
        offset = 0
        while True:
            r = await self._http.get(
                table, params=params or {},
                headers={"Range-Unit": "items",
                         "Range": f"{offset}-{offset + PAGE - 1}",
                         "Prefer": "count=exact"},
            )
            if r.status_code >= 400:
                self._raise(r)
            page = r.json()
            rows.extend(page)

            # "0-392/393" -> total 393. A '*' total (count not honoured) or an
            # empty page both mean stop; an empty page also guards against a
            # zero-progress loop.
            total_part = r.headers.get("content-range", "*/*").split("/")[-1]
            if not page or not total_part.isdigit():
                return rows
            offset += len(page)
            if offset >= int(total_part):
                return rows

    async def insert(self, table: str, rows: list[dict]) -> list[dict]:
        """POST rows, returning them as stored (defaults and triggers applied)."""
        r = await self._http.post(
            table, json=rows,
            headers={"Content-Type": "application/json", "Prefer": "return=representation"},
        )
        if r.status_code >= 400:
            self._raise(r)
        return r.json()

    async def update(self, table: str, params: dict[str, str], patch: dict) -> list[dict]:
        """PATCH the rows matched by `params`, returning the updated rows.

        `params` must contain a filter -- PostgREST would otherwise rewrite the
        whole table.
        """
        if not params:
            raise ValueError("update() requires a filter; refusing an unfiltered PATCH")
        r = await self._http.patch(
            table, params=params, json=patch,
            headers={"Content-Type": "application/json", "Prefer": "return=representation"},
        )
        if r.status_code >= 400:
            self._raise(r)
        return r.json()


_client: SupabaseClient | None = None


def init_client() -> SupabaseClient:
    """Build the singleton. Called once from the app lifespan."""
    global _client
    url, key = load_credentials()
    _client = SupabaseClient(url, key)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def get_client() -> SupabaseClient:
    """FastAPI dependency: the live client, or a 503-worthy error if unopened."""
    if _client is None:
        raise RuntimeError("Supabase client is not initialised; app lifespan did not run.")
    return _client
