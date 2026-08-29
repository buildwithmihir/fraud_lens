import React, { useMemo, useState } from 'react'
import { IconRotate } from '@tabler/icons-react'
import {
  RULES,
  bandFor,
  bandLabel,
  isFlagged,
  scoreFor,
} from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'
import { BandChip, StatusPill } from './RiskBadges'

/**
 * "What would this score be if ...": toggle each rule and recompute.
 *
 * The recompute is the real scorer arithmetic -- the same weights
 * model/score_transaction.py uses -- so the numbers here match what a re-score
 * would persist. Nothing is written back; this is an analyst's scratchpad.
 *
 * It also happens to be the clearest demonstration of why band and status are
 * separate: turning rules off walks the score through 76 -> 71 -> 67, which stays
 * in the 61-85 "Analyst review" band the whole way while the status flips from
 * flagged to normal at 67.
 */
export default function CounterfactualSlider({ transaction }) {
  const threshold = useThreshold()
  const initial = useMemo(
    () => new Set(transaction?.fired ?? []),
    [transaction?.id, transaction?.fired],
  )
  const [active, setActive] = useState(initial)
  const [dirty, setDirty] = useState(false)

  // Reset when a different transaction is selected.
  const [seenId, setSeenId] = useState(transaction?.id)
  if (transaction?.id !== seenId) {
    setSeenId(transaction?.id)
    setActive(initial)
    setDirty(false)
  }

  if (!transaction) return null

  const toggle = (key) => {
    setActive((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
    setDirty(true)
  }

  const reset = () => {
    setActive(initial)
    setDirty(false)
  }

  const score = scoreFor(active)
  const band = bandFor(score)
  const flagged = isFlagged(score, threshold)
  const delta = score - transaction.risk
  const statusChanged = flagged !== isFlagged(transaction.risk, threshold)
  const bandChanged = band.id !== bandFor(transaction.risk).id

  return (
    <div className="bg-ink-100 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ink-700">Counterfactual</p>
        {dirty && (
          <button
            onClick={reset}
            className="flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 transition"
          >
            <IconRotate size={12} stroke={1.75} />
            Reset
          </button>
        )}
      </div>

      <div className="space-y-1 mb-3">
        {RULES.map((rule) => {
          const on = active.has(rule.key)
          return (
            <label
              key={rule.key}
              className="flex items-center gap-2 text-[11px] cursor-pointer group py-0.5"
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(rule.key)}
                className="w-3.5 h-3.5 rounded border-ink-300 text-brand-600 focus:ring-2 focus:ring-brand-400 cursor-pointer"
              />
              <span className={on ? 'text-ink-900 flex-1' : 'text-ink-500 flex-1'}>
                {rule.label}
              </span>
              <span className={`tabular-nums ${on ? 'text-ink-700' : 'text-ink-300'}`}>
                +{rule.weight}
              </span>
            </label>
          )
        })}
      </div>

      {/* Meter: fill in the band's ramp step, track in the lightest step of the
          same hue, so the tier reads across the whole bar. */}
      <div
        className="h-1.5 rounded-full overflow-hidden mb-2"
        style={{ backgroundColor: '#DBEAFE' }}
        role="img"
        aria-label={`risk score ${score} of 100`}
      >
        <div
          className="h-full rounded-full transition-all duration-200"
          style={{ width: `${score}%`, backgroundColor: band.color }}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-baseline gap-1.5">
          <span className="text-lg font-semibold text-ink-900 tabular-nums leading-none">
            {score}
          </span>
          <span className="text-[11px] text-ink-500">/100</span>
          {dirty && delta !== 0 && (
            <span className="text-[11px] text-ink-500 tabular-nums">
              ({delta > 0 ? '+' : ''}
              {delta})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <BandChip score={score} showAction={false} />
          <StatusPill score={score} threshold={threshold} />
        </div>
      </div>

      {dirty && (
        <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">
          {!statusChanged && !bandChanged && 'Same band and same status as scored.'}
          {!statusChanged && bandChanged &&
            `Moves to ${bandLabel(band)} (${band.action}), status unchanged.`}
          {statusChanged && !bandChanged &&
            `Still in ${bandLabel(band)} (${band.action}), but status flips to ${
              flagged ? 'flagged' : 'normal'
            } — the threshold runs through this band.`}
          {statusChanged && bandChanged &&
            `Moves to ${bandLabel(band)} (${band.action}) and status flips to ${
              flagged ? 'flagged' : 'normal'
            }.`}
        </p>
      )}
    </div>
  )
}
