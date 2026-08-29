import React from 'react'
import { IconArrowRight } from '@tabler/icons-react'

/**
 * Where the money went after a flagged transaction.
 *
 * The live schema dropped the chain's hop/label columns, so lib/api.js rebuilds
 * the account path by ordering transfers on timestamp and walking
 * from_account -> to_account. First and last account are the ends of the chain
 * (victim and final destination); the middle accounts are pass-through mules.
 */
export default function MuleChainGraph({ chain }) {
  if (!chain?.accounts?.length) return null
  const { accounts, note, total } = chain

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs font-semibold text-ink-700">Money flow after transaction</p>
        {total > 0 && (
          <p className="text-[11px] text-ink-500 tabular-nums">
            ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 0 })} moved
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {accounts.map((acc, i) => {
          const isEnd = i === 0 || i === accounts.length - 1
          return (
            <div key={`${acc}-${i}`} className="flex items-center gap-1.5">
              <span
                className={`text-[11px] font-medium px-2 py-1 rounded-md ${
                  isEnd ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                }`}
                title={i === 0 ? 'Source account' : i === accounts.length - 1 ? 'Final destination' : 'Pass-through account'}
              >
                {acc}
              </span>
              {i < accounts.length - 1 && (
                <IconArrowRight size={13} className="text-ink-300" stroke={1.75} />
              )}
            </div>
          )
        })}
      </div>
      {note && <p className="text-[11px] text-ink-500 mt-2">{note}</p>}
    </div>
  )
}
