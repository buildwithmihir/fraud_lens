import React from 'react'
import { IconScan, IconFlag, IconAffiliate, IconEye } from '@tabler/icons-react'
import { BANDS, bandFor, isFlagged } from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'

/**
 * Top-line counts, derived from the fetched rows rather than hardcoded.
 *
 * "Flagged" and "In review band" are deliberately two separate tiles: they count
 * different sets, and showing only one of them is what made the two concepts look
 * interchangeable. The review-band tile names its overlap in the subtitle so the
 * relationship is explicit instead of inferred.
 */
export default function StatsBar({ transactions = [], chainByTxn = {} }) {
  const threshold = useThreshold()
  const flagged = transactions.filter((t) => isFlagged(t.risk, threshold))
  const reviewBand = BANDS.find((b) => b.action === 'Analyst review') ?? BANDS[2]
  const inReview = transactions.filter((t) => bandFor(t.risk).id === reviewBand.id)
  const inReviewFlagged = inReview.filter((t) => isFlagged(t.risk, threshold)).length
  const chains = Object.values(chainByTxn).filter(Boolean).length

  const stats = [
    {
      label: 'Scanned',
      value: transactions.length,
      sub: 'all transactions',
      icon: IconScan,
      tone: 'text-ink-900',
    },
    {
      label: 'Flagged',
      value: flagged.length,
      sub: `risk_score > ${threshold}`,
      icon: IconFlag,
      tone: 'text-red-600',
    },
    {
      label: 'In review band',
      value: inReview.length,
      sub: `${reviewBand.min}-${reviewBand.max} · ${inReviewFlagged} of them flagged`,
      icon: IconEye,
      tone: 'text-ink-900',
    },
    {
      label: 'Mule chains',
      value: chains,
      sub: chains === 1 ? 'linked transfer chain' : 'linked transfer chains',
      icon: IconAffiliate,
      tone: 'text-amber-700',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map(({ label, value, sub, icon: Icon, tone }) => (
        <div
          key={label}
          className="bg-white rounded-xl shadow-card border border-ink-100 p-4 flex items-center gap-3"
        >
          <div className="w-9 h-9 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
            <Icon size={18} className="text-brand-600" stroke={1.75} />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-ink-500">{label}</p>
            <p className={`text-lg font-semibold leading-tight ${tone}`}>
              {value.toLocaleString('en-IN')}
            </p>
            <p className="text-[10px] text-ink-500 truncate" title={sub}>
              {sub}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
