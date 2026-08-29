import React from 'react'
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'
import { BANDS, bandBreakdown } from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'

/**
 * Score distribution across the four policy bands.
 *
 * This is the "bands as their own visual element" half of the risk display --
 * status (flagged/normal) is never encoded as color here. Instead each band's
 * normal/flagged split lives in the tooltip and, for the band that straddles the
 * threshold, in the caption under the plot. That way the chart can show that
 * 61-85 contains both without implying band == status.
 *
 * Color is the ordinal blue ramp from lib/risk.js (ordered tiers -> one hue,
 * monotone lightness), validated with the dataviz validator. Band membership is
 * fixed; only the normal/flagged split inside a band moves with the threshold.
 *
 * Every bar is direct-labeled with its count, so no y-axis or gridlines are
 * needed and no value is reachable only via the tooltip.
 */
export default function RiskHistogram({ transactions = [], bands = BANDS }) {
  const threshold = useThreshold()
  const data = bandBreakdown(transactions, threshold, bands)
  const straddling = data.find((b) => b.mixed)

  if (!transactions.length) {
    return (
      <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
        <p className="text-sm font-semibold text-ink-900 mb-1">Risk distribution</p>
        <p className="text-xs text-ink-500">No transactions to plot.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
      <div className="flex items-baseline justify-between mb-1">
        <p className="text-sm font-semibold text-ink-900">Risk distribution</p>
        <p className="text-xs text-ink-500 tabular-nums">
          {transactions.length.toLocaleString('en-IN')} transactions
        </p>
      </div>
      <p className="text-xs text-ink-500 mb-4">
        risk_score grouped by policy band — independent of flagged/normal status.
      </p>

      {/* Height covers plot + the x-axis band so the axis labels are never clipped. */}
      <div style={{ height: 168 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 18, right: 4, bottom: 4, left: 4 }}>
            <XAxis
              dataKey="range"
              tickLine={false}
              axisLine={{ stroke: '#CBD5E1', strokeWidth: 1 }}
              tick={{ fill: '#64748B', fontSize: 11 }}
              interval={0}
            />
            <Tooltip
              cursor={{ fill: '#F1F5F9' }}
              content={<BandTooltip threshold={threshold} />}
            />
            {/* 4px rounded cap, square at the baseline; capped thickness leaves air. */}
            <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              {data.map((band) => (
                <Cell key={band.id} fill={band.color} />
              ))}
              <LabelList
                dataKey="total"
                position="top"
                offset={8}
                fill="#0F172A"
                fontSize={11}
                fontWeight={600}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 pt-3 border-t border-ink-100 space-y-1.5">
        {data.map((band) => (
          <div key={band.id} className="flex items-center gap-2 text-[11px]">
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: band.color }}
              aria-hidden="true"
            />
            <span className="text-ink-700 w-14 shrink-0 tabular-nums">{band.range}</span>
            <span className="text-ink-500 flex-1 truncate">{band.action}</span>
            <span className="text-ink-900 font-medium tabular-nums">{band.total}</span>
          </div>
        ))}
      </div>

      {straddling && (
        <p className="mt-3 text-[11px] text-ink-500 leading-relaxed">
          The flag threshold (&gt;{threshold}) falls inside{' '}
          <span className="text-ink-700 font-medium">{straddling.range}</span>, so that band holds
          both statuses: {straddling.normal} normal, {straddling.flagged} flagged. Band and status
          are separate signals.
        </p>
      )}
    </div>
  )
}

function BandTooltip({ active, payload, threshold }) {
  if (!active || !payload?.length) return null
  const band = payload[0].payload
  return (
    <div className="bg-white border border-ink-300 rounded-lg shadow-card px-3 py-2 text-xs">
      <p className="font-semibold text-ink-900 tabular-nums">{band.range}</p>
      <p className="text-ink-500 mb-1.5">{band.action}</p>
      <p className="text-ink-700 tabular-nums">
        {band.total} transaction{band.total === 1 ? '' : 's'}
      </p>
      <p className="text-ink-500 tabular-nums mt-0.5">
        {band.normal} normal · {band.flagged} flagged
      </p>
      {band.mixed && (
        <p className="text-ink-500 mt-1 pt-1 border-t border-ink-100 max-w-[190px] leading-relaxed">
          Threshold &gt;{threshold} runs through this band.
        </p>
      )}
    </div>
  )
}
