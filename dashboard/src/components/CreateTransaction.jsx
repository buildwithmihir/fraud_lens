import React, { useMemo, useState } from 'react'
import { IconDeviceMobile, IconMapPin, IconUser, IconCalculator } from '@tabler/icons-react'
import { RULES, WEIGHTS, bandFor, bandLabel, scoreFor } from '../lib/risk'
import { BandChip, StatusPill } from './RiskBadges'

/**
 * Score a hypothetical transaction against the live rules.
 *
 * This does not insert anything: RLS rejects anon writes on these tables (see
 * model/seed_supabase.py), and the dashboard holds only the anon key. So instead
 * of pretending to submit, it runs the same four rules against the selected
 * user's real profile and shows what the scorer would persist -- score, band and
 * status -- which is the useful half anyway.
 */
export default function CreateTransaction({ users = [] }) {
  const [userId, setUserId] = useState(users[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const [location, setLocation] = useState('')
  const [device, setDevice] = useState('known')
  const [hour, setHour] = useState('12')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const user = useMemo(() => users.find((u) => u.id === userId) ?? users[0], [users, userId])
  const handleSubmit = (e) => {
    e.preventDefault()
    if (!amount || Number(amount) <= 0) {
      setError('Enter a valid amount.')
      setResult(null)
      return
    }
    if (!location.trim()) {
      setError('Enter a location.')
      setResult(null)
      return
    }
    if (!user) {
      setError('Select a user.')
      setResult(null)
      return
    }

    setError('')

    // Work out which of the four rules this hypothetical transaction trips,
    // using the same logic the real scorer applies (model/score_transaction.py).
    const fired = new Set()

    if (Number(amount) > user.avgSpend * 10) {
      fired.add('amount')
    }
    if (device === 'new') {
      fired.add('device')
    }
    if (
      location.trim() &&
      !user.typicalLocations.some((loc) => loc.toLowerCase() === location.trim().toLowerCase())
    ) {
      fired.add('location')
    }
    const h = Number(hour)
    if (h < 6 || h > 23) {
      fired.add('hour')
    }

    const score = scoreFor(fired)
    setResult({ score, fired })
  }
  return (
    <div className="bg-white rounded-xl shadow-card border border-ink-100 p-5">
      <p className="text-sm font-semibold text-ink-900 mb-1">Score a test transaction</p>
      <p className="text-xs text-ink-500 mb-4">
        Runs the four scoring rules against a real user profile. Nothing is written to Supabase.
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="flex items-center gap-1.5 text-xs font-medium text-ink-700 mb-1.5">
            <IconUser size={13} stroke={1.75} />
            User
          </label>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full text-xs border border-ink-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
          >
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          {user && (
            <p className="text-[11px] text-ink-500 mt-1 tabular-nums">
              Avg ₹{user.avgSpend.toLocaleString('en-IN', { maximumFractionDigits: 2 })} · usually
              in {user.typicalLocations.join(', ') || '—'}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-ink-700 block mb-1.5">Amount (₹)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={user ? `> ${Math.round(user.avgSpend * 10)} trips the rule` : 'e.g. 5000'}
              className="w-full text-xs border border-ink-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-ink-700 block mb-1.5">Hour (UTC)</label>
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(e.target.value)}
              className="w-full text-xs border border-ink-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 tabular-nums"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-700 mb-1.5">
              <IconMapPin size={13} stroke={1.75} />
              Location
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={user?.typicalLocations[0] || 'e.g. Mumbai'}
              className="w-full text-xs border border-ink-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400"
            />
          </div>
          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-700 mb-1.5">
              <IconDeviceMobile size={13} stroke={1.75} />
              Device
            </label>
            <select
              value={device}
              onChange={(e) => setDevice(e.target.value)}
              className="w-full text-xs border border-ink-300 rounded-md px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            >
              <option value="known">Known device</option>
              <option value="new">New device</option>
            </select>
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <button
          type="submit"
          className="w-full flex items-center justify-center gap-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg py-2.5 transition"
        >
          <IconCalculator size={14} stroke={1.75} />
          Score it
        </button>
      </form>

      {result && (
        <div className="mt-4 pt-4 border-t border-ink-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-semibold text-ink-900 tabular-nums leading-none">
                {result.score}
              </span>
              <span className="text-[11px] text-ink-500">/100</span>
            </div>
            <div className="flex items-center gap-2">
              <BandChip score={result.score} showAction={false} />
              <StatusPill score={result.score} />
            </div>
          </div>
          <p className="text-[11px] text-ink-500 mb-1.5">
            {bandLabel(bandFor(result.score))} · {bandFor(result.score).action}
          </p>
          <ul className="space-y-0.5">
            {RULES.map((rule) => (
              <li
                key={rule.key}
                className={`flex justify-between text-[11px] ${
                  result.fired.has(rule.key) ? 'text-ink-900' : 'text-ink-300'
                }`}
              >
                <span>{rule.label}</span>
                <span className="tabular-nums">
                  {result.fired.has(rule.key) ? `+${WEIGHTS[rule.key]}` : '—'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
