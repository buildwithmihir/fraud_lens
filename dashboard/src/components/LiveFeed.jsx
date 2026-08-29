import React from 'react'
import { BandChip, ScoreValue, StatusPill } from './RiskBadges'

/**
 * The triage queue, highest risk first.
 *
 * Every row shows all three signals side by side: the score, the policy band it
 * falls in, and the flagged/normal status derived from the live threshold.
 * Earlier this component showed the score only when a row was flagged and the
 * word "normal" otherwise, which made the two look like one signal and hid the
 * score of in-band normal rows entirely -- a 67 (Analyst review, status normal)
 * rendered identically to a 0.
 */
export default function LiveFeed({ transactions, selectedId, onSelect }) {
  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-ink-100 flex items-baseline justify-between">
        <p className="text-sm font-semibold text-ink-900">Live queue</p>
        <p className="text-[11px] text-ink-500 tabular-nums">{transactions.length}</p>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {transactions.map((tx) => {
          const isSelected = tx.id === selectedId
          return (
            <button
              key={tx.id}
              onClick={() => onSelect(tx.id)}
              aria-current={isSelected}
              className={`w-full px-4 py-3 border-b border-ink-100 last:border-0 text-left transition
                ${isSelected ? 'bg-brand-50' : 'hover:bg-ink-100'}`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-ink-900 truncate">
                  ₹{tx.amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </span>
                <ScoreValue score={tx.risk} scored={tx.scored} />
              </div>
              <div className="flex items-center justify-between gap-2">
                <BandChip score={tx.risk} showAction={false} />
                <StatusPill score={tx.risk} />
              </div>
              <p className="text-[11px] text-ink-500 truncate mt-1.5">
                {tx.user.name} · {tx.location}
              </p>
            </button>
          )
        })}
        {!transactions.length && (
          <p className="px-4 py-6 text-xs text-ink-500 text-center">No transactions.</p>
        )}
      </div>
    </div>
  )
}
