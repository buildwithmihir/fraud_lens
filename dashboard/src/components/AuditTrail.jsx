import React, { useEffect, useState } from 'react'
import { IconFileText } from '@tabler/icons-react'

const API_BASE = 'http://localhost:8000'

/** First six hex digits of a uuid, in the dashboard's TX- shorthand. */
const shortId = (id) => (id ? `TX-${String(id).slice(0, 6).toUpperCase()}` : '—')

const decisionColor = {
  'Confirm fraud': 'text-red-600',
  'Mark legitimate': 'text-emerald-600',
  Escalate: 'text-amber-600',
}

/** One audit row: the decision plus the joined transaction's display fields. */
function AuditRow({ row }) {
  const when = new Date(row.decided_at)
  const whenLabel = Number.isNaN(when.getTime())
    ? '--'
    : `${when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · ${when
        .toISOString()
        .slice(11, 16)} UTC`

  return (
    <div className="flex items-center justify-between text-xs border-b border-ink-100 last:border-0 pb-3 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium text-ink-900">{shortId(row.transaction_id)}</p>
        <p className="text-ink-500 truncate">
          {row.user_name ? `${row.analyst_name} · ${row.user_name}` : row.analyst_name}
        </p>
        {row.reason && (
          <p className="text-ink-500 italic truncate" title={row.reason}>
            “{row.reason}”
          </p>
        )}
      </div>
      <div className="text-right shrink-0">
        <p className={`font-medium ${decisionColor[row.decision] ?? 'text-ink-700'}`}>
          {row.decision}
        </p>
        <p className="text-ink-500">{whenLabel}</p>
      </div>
    </div>
  )
}

/**
 * Analyst decisions, live. GET /decisions returns every recorded row, newest
 * first, each carrying its transaction's display fields -- transaction_id is
 * nullable, so a decision that outlived its transaction still renders, just
 * without the joined name.
 */
export default function AuditTrail() {
  // null means "still loading" so an empty table and a pending request render
  // differently instead of flashing the empty-state message.
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    const controller = new AbortController()

    ;(async () => {
      try {
        const res = await fetch(`${API_BASE}/decisions`, { signal: controller.signal })
        if (!res.ok) {
          // FastAPI errors carry {detail}; fall back to the status line if not JSON.
          const detail = await res.json().catch(() => null)
          throw new Error(detail?.detail || `${res.status} ${res.statusText}`)
        }
        setRows(await res.json())
        setError(null)
      } catch (err) {
        if (err.name === 'AbortError') return
        setError(err.message || String(err))
      }
    })()

    return () => controller.abort()
  }, [])

  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900 mb-1">
        <IconFileText size={16} className="text-brand-600" stroke={1.75} />
        Audit trail
      </p>
      <p className="text-xs text-ink-500 mb-4">
        Analyst decisions recorded from the case panel, newest first.
      </p>

      {error && (
        <p className="text-xs text-red-600 mb-3">
          Could not load decisions: {error}
        </p>
      )}

      {!error && rows === null && (
        <p className="text-xs text-ink-500">Loading decisions…</p>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <p className="text-xs text-ink-500">
          No decisions recorded yet. Confirm fraud, mark legitimate, or escalate
          from a transaction's case panel.
        </p>
      )}

      {!error && rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <AuditRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  )
}
