"""Seed Supabase from model/data/synthetic_data.json.

Reads credentials (never writes them) with this precedence:
  1. env vars SUPABASE_URL / SUPABASE_KEY
  2. backend/.env    -> SUPABASE_URL, SUPABASE_KEY
  3. dashboard/.env  -> VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

Seeding requires a service_role key: RLS on these tables rejects anon inserts
(42501). Put it in backend/.env as SUPABASE_KEY, or export SUPABASE_KEY.

Row ids are deterministic uuid5 values derived from the synthetic ids, and rows
are upserted on the primary key — so re-running is idempotent, not duplicating.

The live schema is narrower than synthetic_data.json; unmapped fields are
dropped (see MAPPING_NOTES below).
"""

import base64
import json
import sys
import uuid
from pathlib import Path

import httpx
from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parent.parent
DATA_PATH = ROOT / "model" / "data" / "synthetic_data.json"
NS = uuid.UUID("6f9619ff-8b86-d011-b42d-00c04fc964ff")  # fixed namespace for uuid5
BATCH = 200

MAPPING_NOTES = [
    "users.account_id       -> no such column; account ids live only in transfers",
    "transactions.is_anomalous/anomaly_reasons -> folded into risk_score + status",
    "transfers.chain_id/hop/from_label/to_label -> no such columns; order via timestamp",
]


def load_credentials():
    """Resolve url/key from env then .env files. Read-only."""
    import os

    backend = dotenv_values(ROOT / "backend" / ".env")
    dash = dotenv_values(ROOT / "dashboard" / ".env")

    url = (os.environ.get("SUPABASE_URL") or backend.get("SUPABASE_URL")
           or dash.get("VITE_SUPABASE_URL"))
    key = (os.environ.get("SUPABASE_KEY") or backend.get("SUPABASE_KEY")
           or dash.get("VITE_SUPABASE_ANON_KEY"))
    src = "backend/.env" if backend.get("SUPABASE_KEY") else (
        "env var" if os.environ.get("SUPABASE_KEY") else "dashboard/.env (anon)")
    if not url or not key:
        sys.exit("No Supabase URL/key found in env, backend/.env, or dashboard/.env.")
    return url.rstrip("/"), key, src


def key_role(key):
    """Best-effort JWT role claim, for a readable warning. Never prints the key."""
    try:
        payload = key.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        return json.loads(base64.urlsafe_b64decode(payload)).get("role", "unknown")
    except Exception:
        return "service_role" if key.startswith("sb_secret_") else "unknown"


def count(client, url, table):
    r = client.get(f"{url}/rest/v1/{table}", params={"select": "id", "limit": "1"},
                   headers={"Prefer": "count=exact"})
    r.raise_for_status()
    return int(r.headers["content-range"].split("/")[-1])


def upsert(client, url, table, rows):
    """Upsert in batches on the primary key."""
    total = 0
    for i in range(0, len(rows), BATCH):
        chunk = rows[i:i + BATCH]
        r = client.post(
            f"{url}/rest/v1/{table}", json=chunk,
            headers={"Content-Type": "application/json",
                     "Prefer": "return=minimal,resolution=merge-duplicates"},
        )
        if r.status_code >= 400:
            detail = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
            if isinstance(detail, dict) and detail.get("code") == "42501":
                sys.exit(f"\nRLS blocked insert into {table!r} - this key is not "
                         f"service_role.\nAdd SUPABASE_KEY=<service_role key> to "
                         f"backend/.env and re-run.\n  {detail.get('message')}")
            sys.exit(f"\nInsert into {table!r} failed (HTTP {r.status_code}): {detail}")
        total += len(chunk)
        print(f"  {table}: {total}/{len(rows)}")
    return total


def build_rows(data):
    """Map synthetic JSON onto the live schema."""
    uid = {u["user_id"]: str(uuid.uuid5(NS, u["user_id"])) for u in data["users"]}
    tid = {t["transaction_id"]: str(uuid.uuid5(NS, t["transaction_id"]))
           for t in data["transactions"]}

    users = [{
        "id": uid[u["user_id"]],
        "name": u["name"],
        "account_created_at": u["account_created_at"][:10],   # column is DATE
        "avg_transaction_amount": u["avg_transaction_amount"],
        "typical_locations": u["typical_locations"],           # text[]
        "known_devices": u["known_devices"],                   # text[]
    } for u in data["users"]]

    txns = []
    for t in data["transactions"]:
        anom = t["is_anomalous"]
        # risk_score is 0-100 (dashboard policy bands); derive it deterministically
        # so re-seeding is stable: anomalies land in the 86-100 band, rest in 0-30.
        seed = int(uuid.uuid5(NS, t["transaction_id"]).hex[-4:], 16)
        txns.append({
            "id": tid[t["transaction_id"]],
            "user_id": uid[t["user_id"]],
            "timestamp": t["timestamp"].rstrip("Z"),           # column is naive
            "amount": t["amount"],
            "location": t["location"],
            "device_id": t["device_id"],
            "risk_score": (88 + seed % 12) if anom else (2 + seed % 27),
            "status": "flagged" if anom else "normal",
        })

    transfers = [{
        "id": str(uuid.uuid5(NS, tr["transfer_id"])),
        "from_account": tr["from_account"],
        "to_account": tr["to_account"],
        "amount": tr["amount"],
        "timestamp": tr["timestamp"].rstrip("Z"),
        "linked_transaction_id": tid[tr["linked_transaction_id"]],
    } for tr in data["transfers"]]

    return users, txns, transfers


def main():
    url, key, src = load_credentials()
    role = key_role(key)
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    users, txns, transfers = build_rows(data)

    print(f"Supabase : {url}")
    print(f"Key      : from {src}, role={role} ({len(key)} chars, not shown)")
    print(f"Source   : {DATA_PATH.relative_to(ROOT)}")
    print(f"Payload  : {len(users)} users, {len(txns)} transactions, "
          f"{len(transfers)} transfers")
    if role == "anon":
        print("\nWARNING: anon key detected - RLS will almost certainly reject "
              "inserts.\n         Set SUPABASE_KEY=<service_role> in backend/.env.")
    print("\nDropped by schema mismatch:")
    for note in MAPPING_NOTES:
        print(f"  - {note}")

    with httpx.Client(timeout=60, headers={"apikey": key,
                                           "Authorization": f"Bearer {key}"}) as c:
        print("\nUpserting (users -> transactions -> transfers, FK order):")
        upsert(c, url, "users", users)
        upsert(c, url, "transactions", txns)
        upsert(c, url, "transfers", transfers)

        print("\n=== Row counts (SELECT count=exact) ===")
        expected = {"users": len(users), "transactions": len(txns),
                    "transfers": len(transfers)}
        ok = True
        for table, want in expected.items():
            got = count(c, url, table)
            mark = "OK " if got == want else "XX "
            ok &= got == want
            print(f"  {mark} {table:14s} {got:>4} (expected {want})")

    print("\nSeed complete." if ok else "\nSeed finished with count mismatches.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
