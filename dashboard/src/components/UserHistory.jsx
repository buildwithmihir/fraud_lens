import React from 'react'
import SpendSparkline from './SpendSparkline'
import { BandChip, StatusPill } from './RiskBadges'
import { isFlagged } from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'

/**
 * Profile and recent activity for the selected transaction's user.
 *
 * The history rows carry the score and band as well as the status, for the same
 * reason the queue does: a 67 here is worth an analyst's attention even though
 * its status is normal at the default threshold.
 */
export default function UserHistory({ user, history = [], selectedId }) {
  const threshold = useThreshold()
  if (!user) {
    return (
      <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5 text-sm text-ink-500">
        No user selected
      </div>
    )
  }

  /*
    Newest first, but the selected transaction is always present.
    Most users' recent activity is unremarkable, so a plain "newest 8" can hide
    the very row being investigated -- a user whose only flagged transaction is
    their 9th-oldest would show eight quiet rows and no sign of it.
  */
  const newest = [...history].reverse()
  const recent = newest.slice(0, 8)
  const selectedRow = newest.find((h) => h.id === selectedId)
  const pinnedOutOfWindow = selectedRow && !recent.some((h) => h.id === selectedId)
  const rows = pinnedOutOfWindow ? [selectedRow, ...recent.slice(0, 7)] : recent

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl shadow-card border border-ink-100 p-4">
        <p className="text-sm font-semibold text-ink-900 mb-3 truncate">{user.name}</p>
        <div className="space-y-1.5 text-xs">
          <Row label="Account age" value={user.accountAge} />
          <Row
            label="Avg. spend"
            value={`₹${user.avgSpend.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
          />
          <Row label="Known devices" value={user.knownDevices} />
          <Row label="Transactions" value={history.length} />
        </div>
        {user.typicalLocations?.length > 0 && (
          <p className="text-[11px] text-ink-500 mt-2.5 pt-2.5 border-t border-ink-100">
            Usually in {user.typicalLocations.join(', ')}
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-card border border-ink-100 p-4">
        <p className="text-sm font-semibold text-ink-900 mb-1">Spend over time</p>
        <p className="text-[11px] text-ink-500 mb-2">
          Amount per transaction, oldest to newest. Red marks a flagged row.
        </p>
        <SpendSparkline history={history} />
      </div>

      <div className="bg-white rounded-xl shadow-card border border-ink-100 p-4">
        <p className="text-sm font-semibold text-ink-900 mb-3">Recent history</p>
        {rows.length ? (
          <div className="space-y-2.5">
            {rows.map((h) => (
              <div
                key={h.id}
                className={`flex items-center justify-between gap-2 text-[11px] ${
                  h.id === selectedId ? 'bg-brand-50 -mx-2 px-2 py-1 rounded-md' : ''
                }`}
              >
                <div className="min-w-0">
                  <p
                    className={`tabular-nums ${
                      isFlagged(h.risk, threshold) ? 'text-red-600 font-medium' : 'text-ink-900'
                    }`}
                  >
                    ₹{h.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                  <p className="text-ink-500 tabular-nums">
                    {new Date(h.timestamp).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                    {h.id === selectedId && <span className="text-brand-600"> · viewing</span>}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {/*
                    A 0 here is a real score: the scorer ran and all four rules
                    passed. An unscored row (no risk_score stored) would also
                    read as 0, so it is labelled instead -- see lib/api.js.
                  */}
                  {h.scored === false ? (
                    <span
                      className="text-ink-500 italic"
                      title="No risk_score stored — not scored yet"
                    >
                      unscored
                    </span>
                  ) : (
                    <span className="text-ink-700 font-medium tabular-nums">{h.risk}</span>
                  )}
                  <BandChip score={h.risk} showAction={false} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-ink-500">No transactions on record.</p>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-500 shrink-0">{label}</span>
      <span className="text-ink-900 font-medium truncate">{value}</span>
    </div>
  )
}
