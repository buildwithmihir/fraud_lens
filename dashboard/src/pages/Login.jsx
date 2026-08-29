import React, { useState } from 'react'
import { IconShieldLock, IconLockAccess } from '@tabler/icons-react'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (username === 'user' && password === 'password') {
      setError('')
      onLogin()
    } else {
      setError('Incorrect username or password.')
    }
  }

  const handleDemoLogin = () => {
    setUsername('user')
    setPassword('password')
    setError('')
    onLogin()
  }

  return (
    <div className="min-h-screen bg-ink-100 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center mb-3">
            <IconShieldLock size={22} className="text-brand-600" stroke={1.75} />
          </div>
          <h1 className="text-lg font-semibold text-ink-900">FraudLens</h1>
          <p className="text-xs text-ink-500">Admin console</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-card border border-ink-100 p-6 space-y-4"
        >
          <div>
            <label className="text-xs font-medium text-ink-700 block mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full text-sm border border-ink-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-ink-700 block mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="w-full text-sm border border-ink-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:border-transparent"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            type="submit"
            className="w-full bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg py-2.5 transition"
          >
            Log in
          </button>
        </form>

        <button
          onClick={handleDemoLogin}
          className="w-full mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-brand-600 bg-white border border-ink-100 hover:bg-brand-50 rounded-lg py-2.5 transition shadow-card"
        >
          <IconLockAccess size={14} stroke={1.75} />
          Use demo credentials
        </button>
      </div>
    </div>
  )
}