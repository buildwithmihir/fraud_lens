# FraudLens

An AI-powered fraud investigation and decision-support platform for banks and UPI payment apps.

Built for **Build $ Bank** — a FinTech Hackathon by Youth Economy Lab, IGDTUW.

## What it does

Most fraud tools show an analyst a raw risk score with no context. FraudLens turns that
score into a full, explainable case: evidence for and against the transaction, a
counterfactual ("what would've made this safe"), the user's transaction history, and
any suspicious money-movement chain across linked accounts — all before a human analyst
makes the final call.

**Core features:**
- Real-time-feeling transaction feed, scored by a trained ML model
- Evidence for / against each flagged transaction
- Counterfactual explanations (which factor tipped the risk score)
- User transaction history, so an anomaly is visible in context
- Mule-chain / pass-through detection across linked accounts
- Analyst decisions (Confirm Fraud / Mark Legitimate / Escalate) with a full audit trail
- Admin panel: configurable flag threshold, risk policy, and a live scoring calculator

## How it's built

- **Model**: XGBoost, trained on the Kaggle Credit Card Fraud Detection dataset
- **Database**: Supabase (Postgres) — stores users, transactions, transfers, decisions, and settings
- **Backend**: FastAPI (Python) — serves transactions, user history, and records analyst decisions
- **Frontend**: React + Tailwind CSS

## Project structure

```
fraudlens/
├── model/       # Training script, synthetic data generator, Supabase seeder
├── backend/     # FastAPI app and routes
├── dashboard/   # React frontend
└── docs/        # Architecture notes, PPT, explainer docs
```

## Running it locally

You'll need two terminals open at once.

**1. Backend**
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
Runs at `http://localhost:8000`.

**2. Frontend**
```bash
cd dashboard
npm install
npm run dev
```
Runs at `http://localhost:5173` — open this in your browser.

**Login**: use the "Use demo credentials" button on the login screen, or `user` / `password`.

## Data

There's no public, verified UPI fraud dataset available (banks don't release that data),
so the model is trained on the Kaggle Credit Card Fraud Detection dataset — one of the few
real, labeled fraud datasets publicly available. The UPI-specific behavior (new device,
new beneficiary, unusual location, mule-account chains) is our own logic layered on top.

Since we don't have access to a real bank's database, the users and transaction histories
in the dashboard are realistic synthetic data, generated with:
```bash
python model/generate_synthetic_data.py
python model/seed_supabase.py
```

In an actual deployment, this layer would be replaced by the institution's own live
transaction data, connected through secure internal APIs.

## Notes

- This is a hackathon prototype — not connected to any real bank, UPI provider, or real
  customer data.
- Deployment was intentionally skipped in favor of a local demo; the app runs entirely
  on `localhost`.