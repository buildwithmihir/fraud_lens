import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_FLAG_THRESHOLD } from './risk'
import { fetchThreshold, saveThreshold } from './settings'

/**
 * One live threshold for the whole dashboard.
 *
 * Every flagged/normal label is derived from risk_score against this value at
 * render time, so a change here re-labels the entire UI without touching a
 * single transaction row.
 *
 * This is a context rather than a prop chain on purpose. A `threshold =
 * DEFAULT_FLAG_THRESHOLD` default parameter on each component meant a forgotten
 * prop silently rendered against 70 and looked perfectly fine. useThreshold()
 * throws outside the provider instead, so that mistake fails loudly.
 */

const ThresholdContext = createContext(null)

export function ThresholdProvider({ children }) {
  const [threshold, setThreshold] = useState(DEFAULT_FLAG_THRESHOLD)
  const [source, setSource] = useState('loading') // 'loading' | 'settings' | 'default'
  const [detail, setDetail] = useState(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    const result = await fetchThreshold()
    setThreshold(result.threshold)
    setSource(result.source)
    setDetail(result.detail)
    return result
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchThreshold().then((result) => {
      if (cancelled) return
      setThreshold(result.threshold)
      setSource(result.source)
      setDetail(result.detail)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (value) => {
    setSaving(true)
    const result = await saveThreshold(value)
    setSaving(false)
    if (result.ok) {
      // Optimistically adopt it: the row is written, so every consumer should
      // re-derive against the new value immediately, not after a refresh.
      setThreshold(result.threshold)
      setSource('settings')
      setDetail(null)
    }
    return result
  }, [])

  const value = useMemo(
    () => ({ threshold, source, detail, saving, save, reload, isPersisted: source === 'settings' }),
    [threshold, source, detail, saving, save, reload],
  )

  return <ThresholdContext.Provider value={value}>{children}</ThresholdContext.Provider>
}

/** Full threshold state, for the admin editor and the setup notice. */
export function useThresholdState() {
  const ctx = useContext(ThresholdContext)
  if (!ctx) {
    throw new Error('useThresholdState must be used inside <ThresholdProvider>')
  }
  return ctx
}

/** Just the current value -- what display components need. */
export function useThreshold() {
  return useThresholdState().threshold
}
