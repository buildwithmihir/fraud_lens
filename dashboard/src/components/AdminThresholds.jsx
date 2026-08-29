import React, { useEffect, useState } from 'react'
import { IconAlertTriangle, IconCheck, IconDeviceFloppy, IconRotate } from '@tabler/icons-react'
import { BANDS, DEFAULT_FLAG_THRESHOLD, bandFor, bandLabel, straddlesThreshold } from '../lib/risk'
import { useThresholdState } from '../lib/ThresholdContext'

/**
 * Edit the flag threshold. This is the one place it is written.
 *
 * The value is stored in Supabase (settings.flag_threshold), so it survives a
 * refresh and is shared by everyone looking at the dashboard. Saving updates that
 * single row -- every flagged/normal label in the UI is derived from risk_score
 * at render time, so no transaction row is ever rewritten.
 *
 * The default (70) sits inside the 61-85 band, which is why a band and a status
 * are not interchangeable. Rather than hide that, this panel shows which band the
 * threshold cuts through and offers to snap it to a band edge -- so the mismatch
 * is a visible, deliberate setting.
 */
export default function AdminThresholds({ transactions = [] }) {
  const { threshold: saved, source, detail, saving, save, reload } = useThresholdState()

  // Local draft, so dragging the slider does not write on every pixel.
  const [draft, setDraft] = useState(saved)
  const [feedback, setFeedback] = useState(null)

  // Adopt the stored value once it loads, and whenever it changes elsewhere.
  useEffect(() => {
    setDraft(saved)
  }, [saved])

  const update = (value) => {
    const n = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
    setDraft(n)
    setFeedback(null)
  }

  const commit = async () => {
    const result = await save(draft)
    setFeedback(
      result.ok
        ? { tone: 'ok', text: `Saved — threshold is now ${result.threshold} for everyone.` }
        : { tone: 'error', text: result.error },
    )
  }

  const dirty = draft !== saved
  // Preview against the draft so the panel shows the effect before saving.
  const cutBand = BANDS.find((b) => straddlesThreshold(b, draft))
  const flaggedCount = transactions.filter((t) => t.risk > draft).length
  const savedFlaggedCount = transactions.filter((t) => t.risk > saved).length
  const edges = BANDS.slice(0, -1).map((b) => b.max)

  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-semibold text-ink-900">Flag threshold</p>
        <SourceBadge source={source} />
      </div>
      <p className="text-xs text-ink-500 mb-4">
        A transaction is flagged when risk_score is strictly above this value. Stored in Supabase and
        applied everywhere on render — no transaction rows are rewritten.
      </p>

      {source === 'default' && detail && (
        <div className="bg-amber-50 rounded-lg p-3 mb-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 mb-1">
            <IconAlertTriangle size={13} stroke={2} />
            Not persisted yet
          </p>
          <p className="text-[11px] text-amber-700 leading-relaxed">{detail}</p>
          <button
            onClick={reload}
            className="mt-2 text-[11px] font-medium text-ink-700 bg-white border border-ink-300 hover:border-brand-400 rounded-md px-2 py-1 transition"
          >
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <input
          type="range"
          min={0}
          max={100}
          value={draft}
          onChange={(e) => update(e.target.value)}
          className="flex-1 accent-brand-600 cursor-pointer"
          aria-label="Flag threshold"
        />
        <input
          type="number"
          min={0}
          max={100}
          value={draft}
          onChange={(e) => update(e.target.value)}
          className="w-16 text-xs text-ink-900 tabular-nums border border-ink-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-400"
          aria-label="Flag threshold value"
        />
      </div>

      <p className="text-xs text-ink-500 tabular-nums mb-3">
        {flaggedCount} of {transactions.length} transactions flagged
        {dirty && (
          <span className="text-ink-700">
            {' '}
            · currently {savedFlaggedCount} at the saved value of {saved}
          </span>
        )}
        {!dirty && draft !== DEFAULT_FLAG_THRESHOLD && (
          <span className="text-ink-700"> · scorer default is {DEFAULT_FLAG_THRESHOLD}</span>
        )}
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={commit}
          disabled={!dirty || saving}
          className={`flex-1 flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg py-2 transition ${
            !dirty || saving
              ? 'bg-ink-100 text-ink-500 cursor-not-allowed'
              : 'bg-brand-600 hover:bg-brand-700 text-white'
          }`}
        >
          <IconDeviceFloppy size={14} stroke={1.75} />
          {saving ? 'Saving…' : dirty ? 'Save threshold' : 'Saved'}
        </button>
        {dirty && (
          <button
            onClick={() => update(saved)}
            className="flex items-center gap-1 text-xs font-medium text-ink-500 hover:text-ink-900 px-2 transition"
          >
            <IconRotate size={13} stroke={1.75} />
            Revert
          </button>
        )}
      </div>

      {feedback && (
        <p
          className={`text-[11px] mb-4 leading-relaxed ${
            feedback.tone === 'ok' ? 'text-emerald-700' : 'text-red-600'
          }`}
        >
          {feedback.text}
        </p>
      )}

      {/* Where the threshold lands relative to each band. */}
      <div className="space-y-1.5 mb-4">
        {BANDS.map((band) => {
          const cut = straddlesThreshold(band, draft)
          return (
            <div
              key={band.id}
              className={`flex items-center gap-2 text-[11px] rounded-md px-2 py-1.5 ${
                cut ? 'bg-ink-100' : ''
              }`}
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: band.color }}
                aria-hidden="true"
              />
              <span className="text-ink-700 w-14 shrink-0 tabular-nums">{bandLabel(band)}</span>
              <span className="text-ink-500 flex-1 truncate">{band.action}</span>
              {cut ? (
                <span className="text-amber-700 font-medium shrink-0">split at {draft}</span>
              ) : (
                <span className="text-ink-500 shrink-0">
                  {band.min > draft ? 'all flagged' : 'all normal'}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {cutBand ? (
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 mb-1">
            <IconAlertTriangle size={13} stroke={2} />
            Threshold splits the {bandLabel(cutBand)} band
          </p>
          <p className="text-[11px] text-amber-700 leading-relaxed mb-2">
            "{cutBand.action}" will contain both normal and flagged rows. That is supported — the
            dashboard shows band and status separately — but if you want them to line up, snap the
            threshold to a band edge.
          </p>
          <div className="flex gap-1.5">
            {edges.map((edge) => (
              <button
                key={edge}
                onClick={() => update(edge)}
                className="text-[11px] font-medium text-ink-700 bg-white border border-ink-300 hover:border-brand-400 rounded-md px-2 py-1 transition tabular-nums"
              >
                Snap to {edge}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
            <IconCheck size={13} stroke={2} />
            Threshold sits on a band edge — bands and status align
          </p>
          <p className="text-[11px] text-emerald-700 leading-relaxed mt-1">
            Every band is now entirely flagged or entirely normal. Band{' '}
            {bandLabel(bandFor(draft))} and below are normal.
          </p>
        </div>
      )}

      <p className="text-[11px] text-ink-500 mt-3 leading-relaxed">
        This changes how the dashboard labels rows. It does not re-score anything: the stored
        risk_score is untouched, and so is the stored status column, which the dashboard no longer
        reads.
      </p>
    </div>
  )
}

function SourceBadge({ source }) {
  const map = {
    loading: { text: 'loading…', cls: 'text-ink-500 bg-ink-100' },
    settings: { text: 'saved in Supabase', cls: 'text-emerald-700 bg-emerald-50' },
    default: { text: 'using default', cls: 'text-amber-700 bg-amber-50' },
  }
  const s = map[source] ?? map.loading
  return (
    <span className={`text-[10px] font-medium rounded-md px-1.5 py-0.5 ${s.cls}`}>{s.text}</span>
  )
}
