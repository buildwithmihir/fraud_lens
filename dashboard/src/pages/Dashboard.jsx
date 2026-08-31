import React, { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import StatsBar from '../components/StatsBar'
import LiveFeed from '../components/LiveFeed'
import TransactionDetail from '../components/TransactionDetail'
import UserHistory from '../components/UserHistory'
import RiskHistogram from '../components/RiskHistogram'
import AdminSettings from '../components/AdminSettings'
import { firedFromEvidence } from '../lib/risk'
import { ThresholdProvider } from '../lib/ThresholdContext'

/**
 * Transactions now come from the FastAPI backend (backend/main.py) rather than
 * from Supabase directly, so the service_role key stays server-side and the
 * scoring/evidence logic has one place to live.
 *
 * GET /transactions returns the whole case per row -- all columns, the embedded
 * user record and the transaction's transfers -- so the queue, evidence cards,
 * user panel and mule-chain graph all render from this single request. The
 * adapters below convert snake_case columns into the camelCase shape the
 * components already expect; they mirror what dashboard/src/lib/api.js did when
 * it read Supabase directly.
 */
const API_BASE = 'http://localhost:8000'

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

/** Whole years between a date column and now, one decimal. */
function accountAgeYears(createdAt) {
  if (!createdAt) return null
  const then = new Date(createdAt)
  if (Number.isNaN(then.getTime())) return null
  return (Date.now() - then.getTime()) / (365.25 * 24 * 3600 * 1000)
}

/**
 * One API row -> the transaction shape the components read.
 *
 * A stored 0 means "the scorer ran and all four rules passed" -- a real result,
 * backed by four evidence_against entries. A missing risk_score would also
 * coerce to 0 and render as an innocuous normal row, so `scored` distinguishes
 * the two explicitly and the badges label an unscored row instead of showing 0.
 */
function adaptTransaction(row) {
  const user = row.user || {}
  const ageYears = accountAgeYears(user.account_created_at)
  const scored = row.risk_score !== null && row.risk_score !== undefined
  return {
    id: row.id,
    shortId: `TX-${String(row.id).slice(0, 6).toUpperCase()}`,
    userId: row.user_id,
    timestamp: row.timestamp,
    amount: Number(row.amount) || 0,
    location: row.location,
    deviceId: row.device_id,
    scored,
    risk: scored ? Number(row.risk_score) : 0,
    status: row.status,
    isNewDevice: row.is_new_device === true,
    evidenceFor: asArray(row.evidence_for),
    evidenceAgainst: asArray(row.evidence_against),
    // Which rules fired, reconstructed from the evidence prose the scorer wrote.
    // Pre-sets the counterfactual toggles; the displayed score always comes from
    // the stored risk_score, never from this.
    fired: firedFromEvidence(row.evidence_for),
    user: {
      id: row.user_id,
      name: row.user_name || user.name || 'Unknown user',
      accountAgeYears: ageYears,
      accountAge: ageYears == null ? '--' : `${ageYears.toFixed(1)} yrs`,
      avgSpend: Number(user.avg_transaction_amount) || 0,
      knownDevices: asArray(user.known_devices).length,
      typicalLocations: asArray(user.typical_locations),
    },
  }
}

/**
 * Rebuild a mule chain from a transaction's transfer rows.
 *
 * The live schema has no hop/label columns (see model/seed_supabase.py
 * MAPPING_NOTES), so hop order comes from the timestamp and the chain is walked
 * from_account -> to_account.
 */
function buildChain(transfers) {
  const hops = [...transfers].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  if (!hops.length) return null
  const accounts = [hops[0].from_account, ...hops.map((h) => h.to_account)]
  const total = hops.reduce((sum, h) => sum + (Number(h.amount) || 0), 0)
  const span = (new Date(hops[hops.length - 1].timestamp) - new Date(hops[0].timestamp)) / 60000
  return {
    accounts,
    hops: hops.length,
    total,
    note:
      hops.length > 1
        ? `${hops.length} hops over ${span < 1 ? '<1' : Math.round(span)} min`
        : '1 hop',
  }
}

/**
 * A user's own rows, oldest first (the sparkline's x order).
 *
 * Deliberately a projection rather than the transaction objects themselves:
 * attaching full transactions under user.history would make the graph cyclic
 * (t.user.history[i].user.history...). These are the only fields UserHistory and
 * SpendSparkline read.
 */
function toHistoryRow(t) {
  return {
    id: t.id,
    timestamp: t.timestamp,
    amount: t.amount,
    risk: t.risk,
    status: t.status,
    scored: t.scored,
  }
}

/** Everything the dashboard needs, from one GET /transactions. */
async function fetchDashboardData(signal) {
  const res = await fetch(`${API_BASE}/transactions`, { signal })
  if (!res.ok) {
    // FastAPI errors carry {detail}; fall back to the status line if not JSON.
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || `${res.status} ${res.statusText}`)
  }
  const rows = await res.json()
  const transactions = rows.map(adaptTransaction)

  // user_id -> their rows, oldest first
  const historyByUser = {}
  for (const t of transactions) {
    ;(historyByUser[t.userId] ||= []).push(toHistoryRow(t))
  }
  for (const list of Object.values(historyByUser)) {
    list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  }

  // The user object carries its own history too, so a transaction is
  // self-contained for anything that only receives `transaction`.
  for (const t of transactions) {
    t.user.history = historyByUser[t.userId] ?? []
  }

  // transaction id -> its chain, for the rows that have transfers
  const chainByTxn = {}
  for (const [i, row] of rows.entries()) {
    const chain = buildChain(asArray(row.transfers))
    if (chain) chainByTxn[transactions[i].id] = chain
  }

  return { transactions, historyByUser, chainByTxn }
}

/**
 * The provider wraps the body so every risk badge, stat and chart derives
 * flagged/normal from one live threshold. No component takes a threshold prop.
 */
export default function Dashboard({ onLogout }) {
  return (
    <ThresholdProvider>
      <DashboardBody onLogout={onLogout} />
    </ThresholdProvider>
  )
}

function DashboardBody({ onLogout }) {
  const [view, setView] = useState('analyst')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    let isFirstLoad = true

    const load = () => {
      fetchDashboardData(controller.signal)
        .then((result) => {
          setData(result)
          setError(null)
          // Only auto-select the first transaction on the very first load —
          // subsequent polls shouldn't yank the analyst away from whatever
          // they're currently reviewing.
          if (isFirstLoad) {
            setSelectedId(result.transactions[0]?.id ?? null)
            isFirstLoad = false
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') return
          setError(err.message || String(err))
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }

    load()
    const interval = setInterval(load, 3000)

    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [])

  const transactions = data?.transactions ?? []
  const selected = useMemo(
    () => transactions.find((t) => t.id === selectedId) ?? null,
    [transactions, selectedId],
  )
  const history = selected ? data?.historyByUser?.[selected.userId] ?? [] : []
  const chain = selected ? data?.chainByTxn?.[selected.id] ?? null : null

  return (
    <div className="min-h-screen bg-ink-100 p-6">
      <div className="max-w-6xl mx-auto">
        <NavBar view={view} onViewChange={setView} onLogout={onLogout} />

        {loading && <Notice>Loading transactions from the API…</Notice>}

        {error && !loading && (
          <Notice tone="error">
            <span className="font-medium">Could not load data.</span> {error}
            <span className="block mt-1 text-ink-500">
              The dashboard reads <code className="text-ink-700">{API_BASE}/transactions</code>.
              Check that the backend is running (
              <code className="text-ink-700">uvicorn main:app --port 8000</code> from{' '}
              <code className="text-ink-700">backend/</code>) and that this origin is in its CORS
              allow-list.
            </span>
          </Notice>
        )}

        {!loading && !error && !transactions.length && (
          <Notice tone="warn">
            <span className="font-medium">Connected, but no rows were returned.</span>
            <span className="block mt-1 text-ink-500">
              The API answered with an empty list, so the request and CORS are fine — the
              transactions table itself looks empty. Seed it with{' '}
              <code className="text-ink-700">python model/seed_supabase.py</code>.
            </span>
          </Notice>
        )}

        {!loading && !error && transactions.length > 0 && view === 'analyst' && (
          <div className="space-y-5">
            <StatsBar
              transactions={transactions}
              chainByTxn={data?.chainByTxn ?? {}}
            />
            <div className="grid grid-cols-[280px_1fr_260px] gap-4 items-start">
              <div className="space-y-4">
                <LiveFeed
                  transactions={transactions}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                />
              </div>
              <div className="space-y-4">
                <TransactionDetail
                  transaction={selected}
                  chain={chain}
                />
                <RiskHistogram transactions={transactions} />
              </div>
              <UserHistory
                user={selected?.user}
                history={history}
                selectedId={selected?.id}
              />
            </div>
          </div>
        )}

        {!loading && !error && transactions.length > 0 && view === 'admin' && (
          <AdminSettings transactions={transactions} />
        )}
      </div>
    </div>
  )
}

function Notice({ children, tone = 'info' }) {
  const tones = {
    info: 'border-ink-100 text-ink-500',
    warn: 'border-amber-200 text-amber-700',
    error: 'border-red-200 text-red-700',
  }
  return (
    <div className={`bg-white rounded-xl shadow-card border p-5 text-sm ${tones[tone]}`}>
      {children}
    </div>
  )
}
