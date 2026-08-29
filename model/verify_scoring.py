"""Read-only verification of the rule scoring persisted in Supabase.

Checks three things and writes nothing back:

  1. The full risk_score distribution across every transaction -- each distinct
     value with the rule combination that produces it, plus the four dashboard
     policy bands.
  2. expected_rules vs the rules that actually fire, for the 18 partial-anomaly
     rows. expected_rules lives only in synthetic_data.json (the live schema
     drops it), so rows are matched back by their deterministic uuid5 id.
  3. status agrees with risk_score on every row: flagged iff risk_score > 70.

Rules are recomputed with score_transaction.score_transaction -- the same
function that wrote the scores -- so a stored-vs-recomputed mismatch means the
write-back is stale, not that the rule logic is wrong. Both are reported.
"""

import json
import sys
import uuid
from collections import Counter
from pathlib import Path

import httpx

from score_transaction import FLAG_THRESHOLD, WEIGHTS, score_transaction
from seed_supabase import DATA_PATH, NS, load_credentials

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PAGE = 500
SELECT = ("id,timestamp,amount,location,device_id,risk_score,status,"
          "users(name,avg_transaction_amount,typical_locations,known_devices)")
# Mirrors dashboard/src/components/RiskPolicyPanel.jsx. Bands are not a
# subdivision of status: FLAG_THRESHOLD (70) falls inside 61-85, so that band
# contains both normal (67) and flagged (71, 76) rows. Check 1 reports the bands
# and Check 3 reports status; they are deliberately independent views.
BANDS = [(0, 30, "Allow"), (31, 60, "Additional verification"),
         (61, 85, "Analyst review"), (86, 100, "High-risk action")]
RULE_ORDER = ["amount", "device", "location", "hour"]


def fetch_all(client, url):
    """Every transaction joined to its user's profile, paginated."""
    rows, offset = [], 0
    while True:
        r = client.get(f"{url}/rest/v1/transactions",
                       params={"select": SELECT, "order": "timestamp.asc",
                               "offset": offset, "limit": PAGE})
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


def sig(rules):
    """Canonical 'amount+hour' signature for a set of rule names."""
    ordered = [r for r in RULE_ORDER if r in set(rules)]
    return "+".join(ordered) if ordered else "(none)"


def main():
    url, key, src = load_credentials()
    data = json.loads(Path(DATA_PATH).read_text(encoding="utf-8"))

    # transaction_id -> expected_rules, keyed by the uuid5 the seeder derived.
    expected_by_id = {
        str(uuid.uuid5(NS, t["transaction_id"])): (t["transaction_id"],
                                                   t["expected_rules"])
        for t in data["transactions"] if t.get("partial_anomaly")
    }

    print(f"Supabase : {url}")
    print(f"Key      : from {src} (not shown)")
    print(f"Weights  : {WEIGHTS}  (all four = {sum(WEIGHTS.values())})")
    print(f"Flag when: risk_score > {FLAG_THRESHOLD}")
    print(f"Local    : {len(data['transactions'])} transactions, "
          f"{len(expected_by_id)} partial anomalies\n")

    with httpx.Client(timeout=60, headers={"apikey": key,
                                           "Authorization": f"Bearer {key}"}) as c:
        rows = fetch_all(c, url)

    print(f"Fetched  : {len(rows)} transactions (joined with user profile)\n")

    # Recompute the rules for every row.
    recomputed = {}
    for t in rows:
        risk, _ev_for, _ev_against, fired = score_transaction(t)
        recomputed[str(t["id"])] = (risk, [n for n in RULE_ORDER if fired[n]])

    # --- Check 1: full risk_score distribution -----------------------------
    print("=== Check 1: risk_score distribution "
          f"(all {len(rows)} transactions) ===")
    dist = Counter(int(t["risk_score"]) for t in rows)
    combos = {}
    for t in rows:
        combos.setdefault(int(t["risk_score"]), Counter())[
            sig(recomputed[str(t["id"])][1])] += 1

    print(f"  {'score':>5}  {'count':>5}  {'status':<8}  rules that fire")
    for score in sorted(dist):
        shown = ", ".join(f"{s} x{n}" if n > 1 else s
                          for s, n in sorted(combos[score].items()))
        st = "flagged" if score > FLAG_THRESHOLD else "normal"
        print(f"  {score:>5}  {dist[score]:>5}  {st:<8}  {shown}")
    print(f"  {'':>5}  {sum(dist.values()):>5}  total")

    print("\n  Policy bands (RiskPolicyPanel):")
    band_total = 0
    for lo, hi, action in BANDS:
        n = sum(v for s, v in dist.items() if lo <= s <= hi)
        band_total += n
        print(f"    {lo:>3}-{hi:<3} {action:<24} {n:>4}  {'#' * min(n, 40)}")
    print(f"    {'':>7} {'':<24} {band_total:>4}  (sum)")

    # Stored scores must equal what the rules produce right now.
    stale = [t for t in rows
             if int(t["risk_score"]) != recomputed[str(t["id"])][0]]
    print(f"\n  stored vs recomputed rule score : "
          f"{len(rows) - len(stale)}/{len(rows)} match, {len(stale)} stale")
    for t in stale[:10]:
        print(f"    {t['id']}  stored {t['risk_score']:>3}  "
              f"recomputed {recomputed[str(t['id'])][0]:>3}  "
              f"({sig(recomputed[str(t['id'])][1])})")
    if len(stale) > 10:
        print(f"    ... and {len(stale) - 10} more")

    # --- Check 2: expected_rules vs actual, partial anomalies --------------
    print(f"\n=== Check 2: expected_rules vs actual "
          f"({len(expected_by_id)} partial-anomaly rows) ===")
    found = [t for t in rows if str(t["id"]) in expected_by_id]
    missing = set(expected_by_id) - {str(t["id"]) for t in rows}

    print(f"  {'txn':<11} {'user':<20} {'exp':>4} {'act':>4}  "
          f"{'expected':<26} {'actual':<26} ok")
    rule_mismatch = 0
    for t in sorted(found, key=lambda r: expected_by_id[str(r["id"])][0]):
        txn_id, expected = expected_by_id[str(t["id"])]
        risk, actual = recomputed[str(t["id"])]
        ok = set(expected) == set(actual)
        rule_mismatch += not ok
        exp_score = sum(WEIGHTS[r] for r in expected)
        print(f"  {txn_id:<11} {t['users']['name']:<20} "
              f"{exp_score:>4} {risk:>4}  {sig(expected):<26} "
              f"{sig(actual):<26} {'OK' if ok else 'XX'}")
    if missing:
        print(f"\n  NOT FOUND in Supabase ({len(missing)}):")
        for mid in sorted(missing):
            print(f"    {expected_by_id[mid][0]}  ({mid})")
    print(f"\n  matched rows : {len(found)}/{len(expected_by_id)}")
    print(f"  rule mismatches : {rule_mismatch}")

    # --- Check 3: status vs risk_score -------------------------------------
    print(f"\n=== Check 3: status agrees with risk_score "
          f"(all {len(rows)} transactions) ===")
    disagree = [t for t in rows
                if (t["status"] == "flagged") != (int(t["risk_score"]) > FLAG_THRESHOLD)]
    by_status = Counter(t["status"] for t in rows)
    for st, n in sorted(by_status.items()):
        print(f"  status {st:<10} {n:>4}")
    print(f"  risk_score >  {FLAG_THRESHOLD}    {sum(1 for t in rows if int(t['risk_score']) > FLAG_THRESHOLD):>4}")
    print(f"  risk_score <= {FLAG_THRESHOLD}    {sum(1 for t in rows if int(t['risk_score']) <= FLAG_THRESHOLD):>4}")
    print(f"\n  disagreements : {len(disagree)}")
    for t in disagree[:20]:
        print(f"    {t['id']}  risk {t['risk_score']:>3}  status {t['status']}")
    if len(disagree) > 20:
        print(f"    ... and {len(disagree) - 20} more")

    # --- Verdict -----------------------------------------------------------
    checks = {
        f"row count == {len(data['transactions'])}": len(rows) == len(data["transactions"]),
        "band sum == row count": band_total == len(rows),
        "stored == recomputed": not stale,
        f"all {len(expected_by_id)} partial rows found": not missing,
        "expected_rules == actual": rule_mismatch == 0,
        "status agrees with risk_score": not disagree,
    }
    print("\n=== Verdict ===")
    for label, passed in checks.items():
        print(f"  {'PASS' if passed else 'FAIL'}  {label}")
    ok = all(checks.values())
    print("\nAll checks passed." if ok else "\nVerification FAILED.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
