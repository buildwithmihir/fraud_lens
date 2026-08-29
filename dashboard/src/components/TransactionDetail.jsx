import React from 'react'
import EvidenceCards from './EvidenceCards'
import MuleChainGraph from './MuleChainGraph'
import CounterfactualSlider from './CounterfactualSlider'
import { BandChip, ScoreValue, StatusPill } from './RiskBadges'
import { IconShieldX, IconCircleCheck, IconFlag3 } from '@tabler/icons-react'

export default function TransactionDetail({ transaction, chain }) {
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
        Decisions are read-only until there is somewhere to record them: the
        schema has no decisions table and the dashboard holds only the anon key,
        so a click would either fail on RLS or silently do nothing. Disabled with
        the reason on hover rather than removed, so the intended workflow is still
        visible in the demo.
      */}
      <div className="pt-1">
        <div className="flex gap-2">
          {decisionActions.map(({ label, icon: Icon }) => (
            <button
              key={label}
              type="button"
              disabled
              title={DECISION_DISABLED_REASON}
              aria-disabled="true"
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium text-ink-500 bg-ink-100 rounded-lg py-2 cursor-not-allowed opacity-60"
            >
              <Icon size={16} stroke={1.75} />
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-ink-500 mt-1.5 text-center">
          {DECISION_DISABLED_REASON}
        </p>
      </div>
    </div>
  )
}

const DECISION_DISABLED_REASON = 'Decision logging not implemented'

const decisionActions = [
  { label: 'Confirm fraud', icon: IconShieldX },
  { label: 'Mark legitimate', icon: IconCircleCheck },
  { label: 'Escalate', icon: IconFlag3 },
]
