import React, { useState } from 'react'
import { IconGripVertical } from '@tabler/icons-react'
import { BANDS, bandLabel, straddlesThreshold } from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'

const actionOptions = ['Allow', 'Additional verification', 'Analyst review', 'High-risk action']

/**
 * Which automatic action fires in each risk band.
 *
 * Bands come from lib/risk.js so this panel, the histogram, the badges and the
 * Python scorer all read the same cutoffs. Bands are NOT the flagged/normal
 * status: whichever band the live threshold falls inside holds both statuses.
 * AdminThresholds shows that split in full; here it is just marked on the
 * affected row, which follows the threshold as it moves.
 */
export default function RiskPolicyPanel() {
  const threshold = useThreshold()
  const [policy, setPolicy] = useState(() =>
    BANDS.map((b) => ({ id: b.id, min: b.min, max: b.max, action: b.action, color: b.color })),
  )

  const updateAction = (id, action) => {
    setPolicy((prev) => prev.map((row) => (row.id === id ? { ...row, action } : row)))
  }

  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
      <p className="text-sm font-semibold text-ink-900 mb-1">Risk policy</p>
      <p className="text-xs text-ink-500 mb-4">
        Configure what action fires automatically at each risk band.
      </p>

      <div className="space-y-2">
        {policy.map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 border border-ink-100 rounded-lg px-3 py-2.5"
          >
            <IconGripVertical size={14} className="text-ink-300" stroke={1.75} />
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />
            <span className="text-xs font-medium text-ink-900 w-14 shrink-0 tabular-nums">
              {bandLabel(row)}
            </span>
            <select
              value={row.action}
              onChange={(e) => updateAction(row.id, e.target.value)}
              className="flex-1 text-xs border border-ink-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            >
              {actionOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {straddlesThreshold(row, threshold) && (
              <span
                className="text-[10px] text-amber-700 font-medium shrink-0"
                title={`The flag threshold (>${threshold}) runs through this band, so it holds both normal and flagged rows.`}
              >
                mixed status
              </span>
            )}
          </div>
        ))}
      </div>

      <button className="mt-4 w-full bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg py-2 transition">
        Save policy
      </button>
      <p className="text-[11px] text-ink-500 mt-2 leading-relaxed">
        Band actions are a display preference — they are not persisted and do not affect scoring.
      </p>
    </div>
  )
}
