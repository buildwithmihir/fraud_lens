import React, { useEffect, useState } from 'react'
import EvidenceCards from './EvidenceCards'
import MuleChainGraph from './MuleChainGraph'
import CounterfactualSlider from './CounterfactualSlider'
import { BandChip, ScoreValue, StatusPill } from './RiskBadges'
import { IconShieldX, IconCircleCheck, IconFlag3 } from '@tabler/icons-react'

const API_BASE = 'http://localhost:8000'

/**
 * There is no analyst identity to read: App.jsx tracks authentication as a
 * boolean and Login.jsx collects no account, so every decision is attributed to
 * this placeholder. Replace it with the signed-in analyst once auth carries one.
 */
const ANALYST_NAME = 'Dashboard analyst'

const decisionActions = [
  { label: 'Confirm fraud', icon: IconShieldX },
  { label: 'Mark legitimate', icon: IconCircleCheck },
  { label: 'Escalate', icon: IconFlag3 },
]

export default function TransactionDetail({ transaction, chain }) {
  // `pending` holds the label being submitted, so only that button shows a
  // spinner-ish state while all three are locked against a double-submit.
  const [pending, setPending] = useState(null)
  const [result, setResult] = useState(null)
  const [reason, setReason] = useState('')

  // A decision belongs to the row it was made on: clear the form and the
  // outcome banner when a different transaction is selected, otherwise the
  // previous row's "recorded" message reads as if it applied to this one.
  useEffect(() => {
    setPending(null)
    setResult(null)
    setReason('')
  }, [transaction?.id])

  if (!transaction) {
    return (
      <div className="bg-white rounded-xl shadow-card border border-ink-100 p-8 flex items-center justify-center text-ink-500 text-sm">
        Select a transaction to view its case
      </div>
    )
  }

  // `status` is deliberately not destructured: the stored column is not used for
  // display anywhere. StatusPill derives it from risk vs the live threshold.
  const { amount, location, deviceId, timestamp, risk, evidenceFor, evidenceAgainst } =
    transaction

  const when = new Date(timestamp)
  const whenLabel = Number.isNaN(when.getTime())
    ? '--'
    : `${when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${when
        .toISOString()
        .slice(11, 16)} UTC`

  async function recordDecision(label) {
    setPending(label)
    setResult(null)
    try {
      const res = await fetch(`${API_BASE}/decisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analyst_name: ANALYST_NAME,
          transaction_id: transaction.id,
          decision: label,
          // The column is nullable; send null rather than an empty string so a
          // blank box does not look like a recorded-but-empty justification.
          reason: reason.trim() || null,
        }),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        // FastAPI puts a string in `detail` for HTTPException and an array of
        // field errors there for a 422; flatten both to one line.
        const detail = payload?.detail
        throw new Error(
          typeof detail === 'string'
            ? detail
            : Array.isArray(detail)
              ? detail.map((d) => `${d.loc?.slice(1).join('.')}: ${d.msg}`).join('; ')
              : `${res.status} ${res.statusText}`,
        )
      }
      setResult({ ok: true, label, at: payload?.decided_at })
      setReason('')
    } catch (err) {
      setResult({ ok: false, label, error: err.message || String(err) })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs text-ink-500 truncate">
            {transaction.user.name} · {location}
          </p>
          <p className="text-xl font-semibold text-ink-900">
            ₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
          <p className="text-[11px] text-ink-500 mt-0.5">
            {whenLabel} · {deviceId}
          </p>
        </div>
        {/* Score, band and status as three separate readings of the same row. */}
        <div className="text-right shrink-0">
          <p className="text-xs text-ink-500 mb-0.5">Risk score</p>
          <ScoreValue score={risk} scored={transaction.scored} size="lg" />
          <div className="flex items-center justify-end gap-2 mt-1.5">
            <BandChip score={risk} />
            <StatusPill score={risk} />
          </div>
        </div>
      </div>

      <EvidenceCards evidenceFor={evidenceFor} evidenceAgainst={evidenceAgainst} />

      <CounterfactualSlider transaction={transaction} />

      {chain && <MuleChainGraph chain={chain} />}

      {/*
        Decisions POST to the backend, which inserts into the decisions table with
        its service_role key. The dashboard never writes to Supabase directly.
      */}
      <div className="pt-1 space-y-2">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={!!pending}
          placeholder="Reason (optional)"
          aria-label="Reason for this decision"
          className="w-full text-xs border border-ink-300 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-ink-100 disabled:text-ink-500"
        />

        <div className="flex gap-2">
          {decisionActions.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              onClick={() => recordDecision(label)}
              disabled={!!pending}
              aria-busy={pending === label}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-brand-600 rounded-lg py-2 transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Icon size={16} stroke={1.75} />
              {pending === label ? 'Recording…' : label}
            </button>
          ))}
        </div>

        {result && (
          <p
            role="status"
            className={`text-[11px] text-center ${
              result.ok ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {result.ok
              ? `Recorded “${result.label}” as ${ANALYST_NAME}${
                  result.at ? ` at ${new Date(result.at).toISOString().slice(11, 19)} UTC` : ''
                }.`
              : `Could not record “${result.label}”: ${result.error}`}
          </p>
        )}
      </div>
    </div>
  )
}
