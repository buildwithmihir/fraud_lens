"""Generate a synthetic FraudLens dataset: users, transactions, and a mule chain.

Writes model/data/synthetic_data.json. File output only — no database calls.
Seeded and pinned to a fixed "now", so re-running reproduces identical output.
"""

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

OUT_PATH = Path(__file__).resolve().parent / "data" / "synthetic_data.json"

SEED = 42
N_USERS = 15
TXNS_PER_USER = 25
N_ANOMALOUS_USERS = 3
CHAIN_HOPS = 4
NOW = datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc)

random.seed(SEED)

NAMES = [
    "Ava Brennan", "Marcus Oyelaran", "Priya Raghunathan", "Tomas Iversen",
    "Leilani Kahale", "Dmitri Volkov", "Fatima Al-Rashid", "Grace Nakamura",
    "Owen Castellanos", "Ingrid Solberg", "Rafael Mendoza", "Chidi Okonkwo",
    "Hana Petrova", "Julian Whitfield", "Noor Siddiqui",
]
HOME_CITIES = [
    "Mumbai", "Pune", "Bengaluru", "Chennai", "Hyderabad", "Delhi",
    "Kolkata", "Ahmedabad", "Jaipur", "Kochi",
]
# Used only for the anomalous transactions — far from any user's normal set.
FAR_CITIES = ["Lagos", "Bucharest", "Kyiv", "Caracas", "Manila", "Tbilisi"]


def iso(dt):
    return dt.isoformat().replace("+00:00", "Z")


def new_device():
    return f"dev_{random.getrandbits(24):06x}"


# --- Users -----------------------------------------------------------------
users = []
for i, name in enumerate(NAMES, start=1):
    created = NOW - timedelta(days=random.randint(400, 1500), hours=random.randint(0, 23))
    users.append({
        "user_id": f"u{i:03d}",
        "name": name,
        "account_id": f"ACC{1000 + i}",
        "account_created_at": iso(created),
        "avg_transaction_amount": round(random.uniform(40, 350), 2),
        "typical_locations": random.sample(HOME_CITIES, random.randint(2, 3)),
        "known_devices": [new_device(), new_device()],
    })

# --- Transactions ----------------------------------------------------------
flagged_ids = set(random.sample([u["user_id"] for u in users], N_ANOMALOUS_USERS))

transactions = []
tid = 0
for u in users:
    avg = u["avg_transaction_amount"]
    anom_idx = random.randrange(TXNS_PER_USER) if u["user_id"] in flagged_ids else -1
    rows = []
    for j in range(TXNS_PER_USER):
        tid += 1
        day = NOW - timedelta(days=random.randint(1, 180))
        if j == anom_idx:
            # Clearly anomalous on all four axes at once.
            ts = day.replace(hour=random.randint(2, 4), minute=random.randint(0, 59),
                             second=random.randint(0, 59), microsecond=0)
            row = {
                "transaction_id": f"txn_{tid:05d}",
                "user_id": u["user_id"],
                "account_id": u["account_id"],
                "timestamp": iso(ts),
                "amount": round(avg * random.uniform(18, 32), 2),
                "location": random.choice(FAR_CITIES),
                "device_id": new_device(),
                "is_anomalous": True,
                "anomaly_reasons": ["amount_spike", "unknown_device",
                                    "new_location", "odd_hour"],
            }
        else:
            ts = day.replace(hour=random.randint(8, 22), minute=random.randint(0, 59),
                             second=random.randint(0, 59), microsecond=0)
            row = {
                "transaction_id": f"txn_{tid:05d}",
                "user_id": u["user_id"],
                "account_id": u["account_id"],
                "timestamp": iso(ts),
                "amount": round(max(1.0, random.gauss(avg, avg * 0.22)), 2),
                "location": random.choice(u["typical_locations"]),
                "device_id": random.choice(u["known_devices"]),
                "is_anomalous": False,
                "anomaly_reasons": [],
            }
        rows.append(row)
    transactions.extend(sorted(rows, key=lambda r: r["timestamp"]))

# --- Mule chain ------------------------------------------------------------
# Record 1 moves the flagged transaction's funds out to mule A; records 2-4
# hop A -> B -> C -> D, each mule skimming a cut, minutes apart.
flagged = next(t for t in transactions if t["is_anomalous"])
labels = ["A", "B", "C", "D"]
accounts = [f"ACC9{n:03d}" for n in range(1, CHAIN_HOPS + 1)]

transfers = []
src, src_label = flagged["account_id"], "victim"
amount = flagged["amount"]
ts = datetime.fromisoformat(flagged["timestamp"].replace("Z", "+00:00"))
for h in range(CHAIN_HOPS):
    ts += timedelta(minutes=random.randint(6, 38))
    if h:
        amount = round(amount * (1 - random.uniform(0.04, 0.11)), 2)
    transfers.append({
        "transfer_id": f"trf_{h + 1:03d}",
        "chain_id": "chain_001",
        "hop": h + 1,
        "from_account": src,
        "from_label": src_label,
        "to_account": accounts[h],
        "to_label": labels[h],
        "amount": amount,
        "timestamp": iso(ts),
        "linked_transaction_id": flagged["transaction_id"],
    })
    src, src_label = accounts[h], labels[h]

# --- Partial-anomaly tier ---------------------------------------------------
# Transactions that trip a controlled subset of the four scoring rules, so the
# dashboard has real data in the medium-risk policy bands. Appended after the
# mule chain deliberately: the RNG stream above is left untouched, so the
# original 375 transactions and 4 transfers still regenerate byte-for-byte.
#
# With scorer weights amount=28, device=24, location=24, hour=19: one rule tops
# out at 28 (0-30 band), any two land 43-52 (31-60), any three land 67-76
# (61-85). Three-rule rows are therefore required to populate 61-85 at all.
#
# The three-rule tier also straddles FLAG_THRESHOLD=70, which is why all four
# combinations are included: device+location+hour scores 67 and stays normal,
# the other three score 71-76 and flag. That gives the 61-85 band both a normal
# and a flagged row, so the dashboard can show that band and status disagree.
PARTIAL_COMBOS = [
    ["amount"], ["device"], ["location"], ["hour"], ["location"], ["amount"],
    ["amount", "device"], ["amount", "location"], ["amount", "hour"],
    ["device", "location"], ["device", "hour"], ["location", "hour"],
    ["amount", "location"],
    ["amount", "device", "location"], ["amount", "device", "hour"],
    ["amount", "location", "hour"], ["device", "location", "hour"],
    ["amount", "device", "location"],
]
ODD_HOURS = [0, 1, 2, 3, 4, 5, 23]  # every value falls outside 06:00-23:00

for combo in PARTIAL_COMBOS:
    tid += 1
    u = random.choice(users)
    avg = u["avg_transaction_amount"]
    day = NOW - timedelta(days=random.randint(1, 180))
    hour = random.choice(ODD_HOURS) if "hour" in combo else random.randint(8, 22)

    if "device" in combo:
        device = new_device()
        while device in u["known_devices"]:  # guard against a random collision
            device = new_device()
    else:
        device = random.choice(u["known_devices"])

    transactions.append({
        "transaction_id": f"txn_{tid:05d}",
        "user_id": u["user_id"],
        "account_id": u["account_id"],
        "timestamp": iso(day.replace(hour=hour, minute=random.randint(0, 59),
                                     second=random.randint(0, 59), microsecond=0)),
        # 11-16x clears the >10x rule; the normal draw never approaches it.
        "amount": (round(avg * random.uniform(11, 16), 2) if "amount" in combo
                   else round(max(1.0, random.gauss(avg, avg * 0.22)), 2)),
        "location": (random.choice(FAR_CITIES) if "location" in combo
                     else random.choice(u["typical_locations"])),
        "device_id": device,
        "is_anomalous": False,      # reserved for the full 4-rule anomalies
        "anomaly_reasons": [],
        "partial_anomaly": True,
        "expected_rules": combo,
    })

# --- Write -----------------------------------------------------------------
payload = {
    "generated_at": iso(NOW),
    "seed": SEED,
    "summary": {
        "users": len(users),
        "transactions": len(transactions),
        "anomalous_transactions": sum(t["is_anomalous"] for t in transactions),
        "partial_anomalies": sum(t.get("partial_anomaly", False) for t in transactions),
        "transfers": len(transfers),
        "mule_chain": " -> ".join(["victim"] + labels),
    },
    "users": users,
    "transactions": transactions,
    "transfers": transfers,
}

OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")

print(json.dumps(payload["summary"], indent=2))
print(f"\nWrote {OUT_PATH}")

# --- Sample ----------------------------------------------------------------
sample_user = next(u for u in users if u["user_id"] == flagged["user_id"])
sample_txns = [t for t in transactions if t["user_id"] == sample_user["user_id"]]
print("\n=== Flagged user ===")
print(json.dumps(sample_user, indent=2))
print("\n=== 2 normal transactions ===")
print(json.dumps([t for t in sample_txns if not t["is_anomalous"]][:2], indent=2))
print("\n=== Anomalous transaction ===")
print(json.dumps(flagged, indent=2))
print("\n=== Mule chain ===")
print(json.dumps(transfers, indent=2))
