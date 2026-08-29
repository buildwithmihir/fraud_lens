import React from 'react'
import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react'

/**
 * The scorer writes evidence_for / evidence_against as text[] (one entry per
 * rule), so both are rendered as lists. A normal row with nothing fired has an
 * empty evidence_for and a full evidence_against, and vice versa for a 95.
 */
export default function EvidenceCards({ evidenceFor = [], evidenceAgainst = [] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <EvidenceColumn
        tone="red"
        icon={IconAlertCircle}
        title="Evidence for fraud"
        items={evidenceFor}
        empty="No rules fired."
      />
      <EvidenceColumn
        tone="emerald"
        icon={IconCircleCheck}
        title="Evidence against"
        items={evidenceAgainst}
        empty="Every rule fired — nothing speaks for this transaction."
      />
    </div>
  )
}

const tones = {
  red: { bg: 'bg-red-50', text: 'text-red-700', marker: '+' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', marker: '−' },
}

function EvidenceColumn({ tone, icon: Icon, title, items, empty }) {
  const t = tones[tone]
  return (
    <div className={`${t.bg} rounded-lg p-3`}>
      <p className={`flex items-center gap-1.5 text-xs font-semibold ${t.text} mb-1.5`}>
        <Icon size={14} stroke={1.75} />
        {title}
      </p>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className={`flex gap-1.5 text-[11px] ${t.text} leading-relaxed`}>
              <span className="shrink-0 font-semibold" aria-hidden="true">
                {t.marker}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={`text-[11px] ${t.text} opacity-70 leading-relaxed`}>{empty}</p>
      )}
    </div>
  )
}
