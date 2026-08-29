import React from 'react'
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react'
import { BANDS, bandFor, bandLabel, isFlagged } from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'

/**
 * The two risk signals, as two deliberately different-looking badges.
 *
 * Both are derived from risk_score at render time. Neither reads the stored
 * `status` column -- risk_score is the stored fact, status is a view of it.
 *
 *   BandChip   -- blue ordinal ramp, a dot + neutral text. Fixed score cutoffs,
 *                 independent of the threshold.
 *   StatusPill -- red/emerald status color with an icon + word. risk_score
 *                 against the live threshold.
 *
 * They do not imply each other: at the default threshold of 70 the cut falls
 * inside the 61-85 band, so "Analyst review" appears beside both statuses.
 *
 * Band identity rides the coloured dot, never the text: the mid/dark ramp steps
 * would not clear text contrast as small type, and a colored label would read as
 * the same channel as the status pill.
 */

export function BandChip({ score, bands = BANDS, showAction = true, className = '' }) {
  const band = bandFor(score, bands)
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium text-ink-700 bg-ink-100 rounded-md px-1.5 py-0.5 ${className}`}
      title={`risk_score ${bandLabel(band)} — policy action: ${band.action}`}
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: band.color }}
        aria-hidden="true"
      />
      {bandLabel(band)}
      {showAction && <span className="text-ink-500">· {band.action}</span>}
    </span>
  )
}

/**
 * Flagged/normal, computed live.
 *
 * `threshold` is only for previewing a hypothetical cut (the counterfactual and
 * the admin editor); everything else omits it and gets the live value. There is
 * deliberately no `status` prop: passing a stored status through here is what let
 * the display drift from risk_score in the first place.
 */
export function StatusPill({ score, threshold, className = '' }) {
  const live = useThreshold()
  const effective = Number.isFinite(threshold) ? threshold : live
  const flagged = isFlagged(score, effective)
  const Icon = flagged ? IconAlertTriangle : IconCircleCheck
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
        flagged ? 'text-red-600' : 'text-emerald-700'
      } ${className}`}
      title={`status ${flagged ? 'flagged' : 'normal'} — risk_score ${score} ${
        flagged ? '>' : '<='
      } ${effective} (derived, not stored)`}
    >
      <Icon size={13} stroke={2} aria-hidden="true" />
      {flagged ? 'flagged' : 'normal'}
    </span>
  )
}

/**
 * The score itself, always visible regardless of status.
 *
 * Deliberately in ink, not the band color: the two light ramp steps do not clear
 * text contrast (#86b6ef is 2.1:1 on white), and identity is already carried by
 * the BandChip dot beside it.
 *
 * `scored === false` means the row has no risk_score yet, which is not the same
 * as a score of 0 -- a real 0 means every rule passed. Shown as "unscored" so an
 * unscored row can never read as a clean one.
 */
export function ScoreValue({ score, scored = true, size = 'sm' }) {
  if (!scored) {
    return (
      <span
        className={`text-ink-500 italic ${size === 'lg' ? 'text-base' : 'text-xs'}`}
        title="No risk_score stored — this row has not been scored yet"
      >
        unscored
      </span>
    )
  }
  return (
    <span
      className={`font-semibold tabular-nums text-ink-900 ${
        size === 'lg' ? 'text-xl' : 'text-sm'
      }`}
    >
      {score}
      <span className="text-ink-500 font-normal">/100</span>
    </span>
  )
}
