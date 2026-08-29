/**
 * Single source of truth for risk bands, the flag threshold and the rule weights.
 *
 * Mirrors model/score_transaction.py. If FLAG_THRESHOLD or WEIGHTS change there,
 * change them here too -- these are the only copies on the dashboard side.
 *
 * IMPORTANT: bands and status are two different partitions of the same score and
 * are rendered as separate signals throughout the dashboard. Neither is ever read
 * from the stored `status` column -- both are derived from risk_score at render
 * time:
 *
 *   status : risk_score > the live threshold (from the settings table)
 *   bands  : four fixed score cutoffs that drive the automatic action
 *
 * Only status depends on the threshold. Band cutoffs are fixed, so moving the
 * threshold re-labels flagged/normal but never moves a row between bands.
 *
 * The default threshold (70) sits *inside* the 61-85 "Analyst review" band rather
 * than on a band edge, so that band legitimately holds both normal rows (67, from
 * device+location+hour) and flagged rows (71 and 76). A row being in the review
 * band does not make it flagged, and a flagged row is not always in that band --
 * the 86-100 band is flagged-only at the default threshold.
 */

/**
 * Fallback only -- NOT the live threshold.
 *
 * The authoritative value lives in the Supabase settings table and reaches
 * components through useThreshold(). This is what the dashboard falls back to
 * before that row loads, or if it cannot be read. It mirrors FLAG_THRESHOLD in
 * model/score_transaction.py, which is what the scorer used when it last wrote
 * the (now display-irrelevant) status column.
 */
export const DEFAULT_FLAG_THRESHOLD = 70

/** Rule weights, straight from model/score_transaction.py. Sum = 95. */
export const WEIGHTS = { amount: 28, device: 24, location: 24, hour: 19 }

/** Rule metadata, for the counterfactual toggles and evidence labels. */
export const RULES = [
  { key: 'amount', label: 'Amount > 10x user average', short: 'Large amount' },
  { key: 'device', label: 'Unrecognized device', short: 'New device' },
  { key: 'location', label: 'Location outside user history', short: 'New location' },
  { key: 'hour', label: 'Outside 06:00-23:00 UTC', short: 'Odd hour' },
].map((r) => ({ ...r, weight: WEIGHTS[r.key] }))

/**
 * The four policy bands, mirroring RiskPolicyPanel's defaults.
 *
 * `color` is an ordinal ramp: ordered tiers take ONE hue with monotone lightness
 * steps, so the reader sees the order in the color. Steps are the documented
 * blue ramp (250/400/550/700) and were checked with the dataviz validator
 * (`--ordinal`, white card surface): lightness monotone, every adjacent step
 * gap >= 0.06, light end 2.11:1 vs surface. Do not hand-tweak a step -- re-run
 * the validator if you need to change one.
 *
 * These blues deliberately do NOT overlap the red/emerald status colors used
 * elsewhere, so band and status never look like the same channel.
 */
export const BANDS = [
  { id: 1, min: 0, max: 30, action: 'Allow', color: '#86b6ef' },
  { id: 2, min: 31, max: 60, action: 'Additional verification', color: '#3987e5' },
  { id: 3, min: 61, max: 85, action: 'Analyst review', color: '#1c5cab' },
  { id: 4, min: 86, max: 100, action: 'High-risk action', color: '#0d366b' },
]

export const bandLabel = (band) => `${band.min}-${band.max}`

/**
 * The band a score falls in.
 *
 * Matches on the first band whose ceiling the score reaches, so a value that
 * lands between two bands (only possible for a non-integer score -- the scorer
 * only ever produces integers) rounds up into the higher band rather than
 * falling through. Identical to a min/max match for every integer 0-100.
 */
export function bandFor(score, bands = BANDS) {
  const s = Number(score) || 0
  return bands.find((b) => s <= b.max) ?? bands[bands.length - 1]
}

/**
 * Guard against a forgotten threshold argument.
 *
 * Without this, a missing threshold makes `score > undefined` false and every
 * row silently renders as normal -- the exact class of bug this refactor exists
 * to remove. Fail loudly instead.
 */
function requireThreshold(threshold, where) {
  if (!Number.isFinite(threshold)) {
    throw new Error(
      `${where}: a numeric threshold is required (got ${threshold}). ` +
        'Read the live value from useThreshold().',
    )
  }
  return threshold
}

/**
 * The only definition of flagged in the dashboard: strictly above the live
 * threshold. The stored `status` column is never consulted for display.
 */
export function isFlagged(score, threshold) {
  requireThreshold(threshold, 'isFlagged')
  return (Number(score) || 0) > threshold
}

/** Score for a set of fired rule keys -- the counterfactual recompute. */
export function scoreFor(firedKeys) {
  const total = [...firedKeys].reduce((sum, k) => sum + (WEIGHTS[k] || 0), 0)
  return Math.min(total, 100)
}

/**
 * Which rules fired, reconstructed from the evidence prose the scorer stored.
 *
 * The schema keeps evidence_for as human-readable text, not rule keys, so this
 * matches the distinctive part of each string built in score_transaction.py.
 * Used to pre-set the counterfactual toggles; a displayed score always comes
 * from the stored risk_score, never from this.
 *
 * Verified against all 393 seeded rows: scoreFor(firedFromEvidence(row)) equals
 * the stored risk_score for every one. If the evidence wording in
 * score_transaction.py changes, these matchers must change with it.
 */
export function firedFromEvidence(evidenceFor) {
  const items = Array.isArray(evidenceFor) ? evidenceFor : evidenceFor == null ? [] : [evidenceFor]
  const text = items.join(' | ').toLowerCase()
  const fired = new Set()
  if (text.includes('x user average')) fired.add('amount')
  if (text.includes('unrecognized device')) fired.add('device')
  if (text.includes('new location')) fired.add('location')
  if (text.includes('outside the')) fired.add('hour')
  return fired
}

/**
 * True when the threshold falls strictly inside a band, so the band can contain
 * both statuses. Surfaced in AdminThresholds so the mismatch is visible rather
 * than surprising.
 */
export function straddlesThreshold(band, threshold) {
  requireThreshold(threshold, 'straddlesThreshold')
  return threshold >= band.min && threshold < band.max
}

/**
 * Per-band counts split by status -- the tooltip/summary payload.
 *
 * Band membership comes from the fixed cutoffs; only the normal/flagged split
 * inside each band moves with the threshold.
 */
export function bandBreakdown(transactions, threshold, bands = BANDS) {
  requireThreshold(threshold, 'bandBreakdown')
  return bands.map((band) => {
    const rows = transactions.filter((t) => bandFor(t.risk, bands).id === band.id)
    const flagged = rows.filter((t) => isFlagged(t.risk, threshold)).length
    return {
      ...band,
      range: bandLabel(band),
      total: rows.length,
      flagged,
      normal: rows.length - flagged,
      mixed: flagged > 0 && flagged < rows.length,
    }
  })
}
