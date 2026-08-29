import React, { useEffect, useMemo, useState } from 'react'
import NavBar from '../components/NavBar'
import StatsBar from '../components/StatsBar'
import LiveFeed from '../components/LiveFeed'
import TransactionDetail from '../components/TransactionDetail'
import UserHistory from '../components/UserHistory'
import RiskHistogram from '../components/RiskHistogram'
import AdminSettings from '../components/AdminSettings'
import { fetchDashboardData } from '../lib/api'
import { ThresholdProvider } from '../lib/ThresholdContext'

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
    let cancelled = false
    fetchDashboardData()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setSelectedId(result.transactions[0]?.id ?? null)
      })
      .catch((err) => !cancelled && setError(err.message || String(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
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

        {loading && <Notice>Loading transactions from Supabase…</Notice>}

        {error && !loading && (
          <Notice tone="error">
            <span className="font-medium">Could not load data.</span> {error}
            <span className="block mt-1 text-ink-500">
              Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in dashboard/.env, and that RLS
              allows anon reads on transactions, users and transfers.
            </span>
          </Notice>
        )}

        {/*
          A successful read that returns nothing is the RLS signature: PostgREST
          answers 200 with an empty array when row-level security is on and no
          SELECT policy grants the anon role access. Name it explicitly -- an
          empty dashboard otherwise looks like an empty database.
        */}
        {!loading && !error && !transactions.length && (
          <Notice tone="warn">
            <span className="font-medium">Connected, but no rows were returned.</span>
            <span className="block mt-1 text-ink-500">
              The query succeeded, so the URL and anon key are fine. This is almost certainly
              row-level security: the tables have data (seeded via service_role) but no SELECT
              policy grants the <code className="text-ink-700">anon</code> role read access. Add
              read policies for anon on transactions, users and transfers — or sign in with
              Supabase Auth and grant them to <code className="text-ink-700">authenticated</code>.
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
