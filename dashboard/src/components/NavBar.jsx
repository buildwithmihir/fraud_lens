import React from 'react'
import { IconShieldLock, IconLayoutDashboard, IconAdjustments, IconLogout } from '@tabler/icons-react'

export default function NavBar({ view, onViewChange, onLogout }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-brand-50 flex items-center justify-center">
          <IconShieldLock size={16} className="text-brand-600" stroke={1.75} />
        </div>
        <div>
          <h1 className="text-sm font-semibold text-ink-900 leading-none">FraudLens</h1>
          <p className="text-[11px] text-ink-500">Fraud investigation console</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex bg-white border border-ink-100 rounded-lg p-1 shadow-card">
          <button
            onClick={() => onViewChange('analyst')}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition ${
              view === 'analyst' ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100'
            }`}
          >
            <IconLayoutDashboard size={14} stroke={1.75} />
            Analyst view
          </button>
          <button
            onClick={() => onViewChange('admin')}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition ${
              view === 'admin' ? 'bg-brand-600 text-white' : 'text-ink-700 hover:bg-ink-100'
            }`}
          >
            <IconAdjustments size={14} stroke={1.75} />
            Admin
          </button>
        </div>

        <button
          onClick={onLogout}
          className="flex items-center gap-1.5 text-xs font-medium text-ink-500 hover:text-ink-900 px-2 py-1.5 transition"
        >
          <IconLogout size={14} stroke={1.75} />
          Log out
        </button>
      </div>
    </div>
  )
}