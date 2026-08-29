import React from 'react'
import { IconFileText } from '@tabler/icons-react'

/**
 * Analyst decisions. Still sample rows: there is no decisions table in the
 * schema (model/seed_supabase.py creates users, transactions and transfers only)
 * and no write path from the dashboard, so the Confirm/Mark/Escalate buttons in
 * TransactionDetail have nowhere to record to yet. Labelled in the UI so it is
 * not mistaken for live data.
 */
const sampleAudit = [
  { txId: 'TX-4521', analyst: 'A. Sharma', decision: 'Confirm fraud', time: '14:32:08' },
  { txId: 'TX-4498', analyst: 'A. Sharma', decision: 'Mark legitimate', time: '13:58:41' },
  { txId: 'TX-4471', analyst: 'R. Iyer', decision: 'Escalate', time: '12:20:15' },
]

const decisionColor = {
  'Confirm fraud': 'text-red-600',
  'Mark legitimate': 'text-emerald-600',
  Escalate: 'text-amber-600',
}

export default function AuditTrail() {
  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-900 mb-1">
        <IconFileText size={16} className="text-brand-600" stroke={1.75} />
        Audit trail
      </p>
      <p className="text-xs text-ink-500 mb-4">
        Sample rows — no decisions table exists yet, so nothing here is live.
      </p>

      <div className="space-y-3">
        {sampleAudit.map((row, i) => (
          <div key={i} className="flex items-center justify-between text-xs border-b border-ink-100 last:border-0 pb-3 last:pb-0">
            <div>
              <p className="font-medium text-ink-900">{row.txId}</p>
              <p className="text-ink-500">{row.analyst}</p>
            </div>
            <div className="text-right">
              <p className={`font-medium ${decisionColor[row.decision]}`}>{row.decision}</p>
              <p className="text-ink-500">{row.time}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}