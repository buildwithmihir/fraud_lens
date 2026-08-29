import React from 'react'
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from 'recharts'
import { isFlagged } from '../lib/risk'
import { useThreshold } from '../lib/ThresholdContext'

/**
 * A user's transaction amounts over time, oldest to newest.
 *
 * Single series, so no legend -- the card heading names what is plotted. Flagged
 * points wear the status color (red) because here the color genuinely means
 * "bad"; every other point is the brand blue. The last point is direct-labeled
 * so the current value is readable without hovering.
 *
 * Flagged is derived from the live threshold like everywhere else, so moving the
 * threshold repaints the red dots without touching any data.
 */
export default function SpendSparkline({ history = [], height = 56 }) {
  const threshold = useThreshold()

  if (history.length < 2) {
    return (
      <p className="text-xs text-ink-500">
        {history.length === 1 ? 'Only one transaction on record.' : 'No transaction history.'}
      </p>
    )
  }

  const data = history.map((t, i) => ({
    i,
    amount: t.amount,
    risk: t.risk,
    flagged: isFlagged(t.risk, threshold),
    date: new Date(t.timestamp).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    }),
  }))

  const peak = Math.max(...data.map((d) => d.amount))

  return (
    <div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, bottom: 2, left: 6 }}>
            {/* Hidden axis: only sets the domain so the line is not clipped. */}
            <YAxis hide domain={[0, peak * 1.15]} />
            <Tooltip content={<SparkTooltip />} cursor={{ stroke: '#CBD5E1', strokeWidth: 1 }} />
            <Line
              type="monotone"
              dataKey="amount"
              stroke="#2563EB"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              isAnimationActive={false}
              dot={(props) => renderSparkDot(props, data.length)}
              activeDot={{ r: 5, fill: '#2563EB', stroke: '#FFFFFF', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-[10px] text-ink-500 tabular-nums mt-0.5">
        <span>{data[0].date}</span>
        <span>{data[data.length - 1].date}</span>
      </div>
    </div>
  )
}

/**
 * >=8px markers (r>=4) with a 2px surface ring, so overlapping points stay
 * legible. Only flagged points and the final point get a dot -- a marker on
 * every point in a sparkline is noise.
 *
 * Recharts calls the `dot` render prop with {cx, cy, index, payload}; it does not
 * pass the series length, so `total` comes in from a closure at the call site.
 */
function renderSparkDot({ cx, cy, payload, index }, total) {
  const isLast = index === total - 1
  if (!payload.flagged && !isLast) return <g key={`dot-${index}`} />
  return (
    <circle
      key={`dot-${index}`}
      cx={cx}
      cy={cy}
      r={4}
      fill={payload.flagged ? '#DC2626' : '#2563EB'}
      stroke="#FFFFFF"
      strokeWidth={2}
    />
  )
}

function SparkTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-white border border-ink-300 rounded-lg shadow-card px-2.5 py-1.5 text-[11px]">
      <p className="font-semibold text-ink-900 tabular-nums">
        ₹{d.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
      </p>
      <p className="text-ink-500 tabular-nums">
        {d.date} · risk {d.risk}
      </p>
      {d.flagged && <p className="text-red-600 font-medium mt-0.5">flagged</p>}
    </div>
  )
}
