"""Rule-based risk scoring for every transaction in Supabase.

Deliberately does NOT use model/saved_model/fraud_model.pkl. That model was
trained on the anonymized PCA components (V1-V28) of creditcard.csv; those
features do not exist for this synthetic data, so the model is not applicable
here. Scoring is transparent rule logic only, which is also what makes the
evidence_for / evidence_against copy possible.

Weights are scaled so that a transaction tripping all four rules lands at 95 --
inside the 88-99 range seed_supabase.py originally used for anomalies. The flag
threshold does not fall cleanly between rule counts, though: one rule tops out
at 28 and any pair at 43-52, so no single rule or pair can flag on its own, but
the four three-rule combinations straddle the threshold -- device+location+hour
stays normal at 67 while the other three flag at 71-76.

So risk_score bands and status are not the same partition. FLAG_THRESHOLD sits
inside the 61-85 "Analyst review" band, which therefore holds both normal (67)
and flagged (71, 76) rows; the dashboard treats band and status as two separate
signals rather than one. See the band summary at the end of main().

Reads transactions joined to their user's profile, computes risk_score (0-100),
sets status, writes human-readable evidence both ways, and PATCHes each row.
"""

import sys
from datetime import datetime, timezone

import httpx

from seed_supabase import load_credentials  # shared credential precedence

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

AMOUNT_MULTIPLE = 10        # "large" = more than 10x the user's average
HOUR_START, HOUR_END = 6, 23  # normal activity window, 06:00-23:00 UTC
FLAG_THRESHOLD = 70         # status = flagged when risk_score > this
                            # note: 70 is inside the 61-85 band, not on an edge
PAGE = 500

# name -> weight. Sum = 95, so all four firing sits in the 85-99 band.
WEIGHTS = {"amount": 28, "device": 24, "location": 24, "hour": 19}


def score_transaction(txn):
    """Return (risk_score, evidence_for, evidence_against, fired) for one row.

    `fired` maps rule name -> bool, reused to write is_new_device back.
    """
    user = txn["users"]
    avg = float(user["avg_transaction_amount"] or 0)
    amount = float(txn["amount"])
    devices = user["known_devices"] or []
    locations = user["typical_locations"] or []
    device, location = txn["device_id"], txn["location"]

    ts = datetime.fromisoformat(txn["timestamp"])
    ts = ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)
    hour, clock = ts.hour, ts.strftime("%H:%M")
    ratio = amount / avg if avg else float("inf")

    checks = [
        ("amount", amount > AMOUNT_MULTIPLE * avg,
         f"Amount {ratio:.0f}x user average ({amount:,.2f} vs {avg:,.2f} typical)",
         f"Amount consistent with user average ({ratio:.1f}x of {avg:,.2f})"),
        ("device", device not in devices,
         f"Unrecognized device {device}, not among the user's {len(devices)} known devices",
         f"Device {device} matches a device the user has used before"),
        ("location", location not in locations,
         f"New location {location}, outside usual activity in {', '.join(locations)}",
         f"Location {location} matches user history"),
        ("hour", not (HOUR_START <= hour < HOUR_END),
         f"Transaction at {clock} UTC, outside the {HOUR_START:02d}:00-{HOUR_END:02d}:00 window",
         f"Transaction at {clock} UTC, within normal activity hours"),
    ]

    risk, ev_for, ev_against, fired_map = 0, [], [], {}
    for name, fired, why_for, why_against in checks:
        fired_map[name] = bool(fired)
        if fired:
            risk += WEIGHTS[name]
            ev_for.append(why_for)
        else:
            ev_against.append(why_against)
    return min(risk, 100), ev_for, ev_against, fired_map


def fetch_all(client, url):
    """Every transaction joined to its user's profile, paginated."""
    select = ("id,timestamp,amount,location,device_id,"
              "users(name,avg_transaction_amount,typical_locations,known_devices)")
    rows, offset = [], 0
    while True:
        r = client.get(f"{url}/rest/v1/transactions",
                       params={"select": select, "order": "timestamp.asc",
                               "offset": offset, "limit": PAGE})
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < PAGE:
            return rows
        offset += PAGE


def main():
    url, key, src = load_credentials()
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    print(f"Supabase : {url}")
    print(f"Key      : from {src} (not shown)")
    print(f"Weights  : {WEIGHTS}  (all four = {sum(WEIGHTS.values())})")
    print(f"Rules    : amount > {AMOUNT_MULTIPLE}x avg | unknown device | "
          f"new location | hour outside {HOUR_START:02d}:00-{HOUR_END:02d}:00")
    print(f"Flag when: risk_score > {FLAG_THRESHOLD}\n")

    with httpx.Client(timeout=60, headers=headers) as c:
        txns = fetch_all(c, url)
        print(f"Fetched {len(txns)} transactions (joined with user profile)")

        scored = []
        for t in txns:
            risk, ev_for, ev_against, fired = score_transaction(t)
            scored.append((t, risk, ev_for, ev_against, fired))

        flagged = [s for s in scored if s[1] > FLAG_THRESHOLD]
        print(f"Scored   : {len(flagged)} flagged, {len(scored) - len(flagged)} normal\n")

        print("Writing back (PATCH per transaction):")
        for i, (t, risk, ev_for, ev_against, fired) in enumerate(scored, 1):
            r = c.patch(f"{url}/rest/v1/transactions",
                        params={"id": f"eq.{t['id']}"},
                        json={"risk_score": risk,
                              "status": "flagged" if risk > FLAG_THRESHOLD else "normal",
                              "evidence_for": ev_for,
                              "evidence_against": ev_against,
                              # same device check the rule already computed
                              "is_new_device": fired["device"]},
                        headers={"Content-Type": "application/json",
                                 "Prefer": "return=minimal"})
            if r.status_code >= 400:
                sys.exit(f"\nPATCH failed on {t['id']} (HTTP {r.status_code}): {r.text}")
            if i % 75 == 0 or i == len(scored):
                print(f"  {i}/{len(scored)}")

        # --- Confirm from the server, not from what we just sent ---------------
        def count(**params):
            r = c.get(f"{url}/rest/v1/transactions",
                      params={"select": "id", "limit": "1", **params},
                      headers={**headers, "Prefer": "count=exact"})
            return int(r.headers["content-range"].split("/")[-1])

        print("\n=== Server-side counts ===")
        print(f"  flagged (status)        : {count(status='eq.flagged')}")
        print(f"  normal  (status)        : {count(status='eq.normal')}")
        print(f"  risk_score >  {FLAG_THRESHOLD}       : {count(risk_score=f'gt.{FLAG_THRESHOLD}')}")
        print(f"  is_new_device = true    : {count(is_new_device='is.true')}")

        # Bands mirror dashboard/src/components/RiskPolicyPanel.jsx. These counts
        # cut across the status counts above rather than subdividing them: 61-85
        # spans the flag threshold, so it mixes normal and flagged rows.
        print("\n=== Risk bands (RiskPolicyPanel) ===")
        for lo, hi, action in [(0, 30, "Allow"), (31, 60, "Additional verification"),
                               (61, 85, "Analyst review"), (86, 100, "High-risk action")]:
            n = count(**{"and": f"(risk_score.gte.{lo},risk_score.lte.{hi})"})
            print(f"  {lo:>3}-{hi:<3} {action:<24} {n:>4}  {'#' * min(n, 40)}")

        r = c.get(f"{url}/rest/v1/transactions",
                  params={"select": "risk_score,amount,location,device_id,timestamp,"
                                    "evidence_for,evidence_against,users(name)",
                          "status": "eq.flagged", "order": "risk_score.desc"})
        rows = r.json()
        print(f"\n=== All {len(rows)} flagged transactions ===")
        for t in rows:
            print(f"  risk {t['risk_score']:>3}  {t['users']['name']:<20} "
                  f"{float(t['amount']):>10,.2f}  {t['location']:<11} {t['timestamp'][11:16]} UTC")

        if rows:
            t = rows[0]
            print(f"\n=== Evidence detail: {t['users']['name']}, "
                  f"{float(t['amount']):,.2f} in {t['location']} ===")
            print(f"  risk_score {t['risk_score']}  status flagged")
            print("\n  evidence_for:")
            for e in t["evidence_for"]:
                print(f"    + {e}")
            print("\n  evidence_against:")
            for e in t["evidence_against"] or ["(none - every rule fired)"]:
                print(f"    - {e}")

        # A normal row, to show evidence_against is populated there too.
        r = c.get(f"{url}/rest/v1/transactions",
                  params={"select": "risk_score,amount,location,evidence_for,"
                                    "evidence_against,users(name)",
                          "status": "eq.normal", "limit": "1"})
        n = r.json()[0]
        print(f"\n=== Contrast, a normal transaction: {n['users']['name']}, "
              f"{float(n['amount']):,.2f} in {n['location']} ===")
        print(f"  risk_score {n['risk_score']}  status normal")
        print(f"  evidence_for     : {n['evidence_for'] or '(empty - nothing fired)'}")
        print("  evidence_against :")
        for e in n["evidence_against"]:
            print(f"    - {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
