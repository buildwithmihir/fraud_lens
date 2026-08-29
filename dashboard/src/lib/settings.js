/**
 * The flag threshold, stored in Supabase so it persists and is shared.
 *
 * Schema this expects (create it with the SQL in the project notes):
 *
 *   create table public.settings (
 *     key        text primary key,
 *     value      jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *
 * The threshold lives at key 'flag_threshold' with a bare JSON number as its
 * value. Until the table exists (or if RLS hides it) reads fall back to
 * DEFAULT_FLAG_THRESHOLD and report which source was used, so the dashboard
 * still renders and the reason is visible rather than silent.
 *
 * Nothing here touches the transactions table. Changing the threshold changes
 * only this one row -- every flagged/normal label in the UI is derived at render
 * time, so no transaction is ever rewritten.
 */

import { supabase } from './supabaseClient'
import { DEFAULT_FLAG_THRESHOLD } from './risk'

export const SETTINGS_TABLE = 'settings'
export const THRESHOLD_KEY = 'flag_threshold'

/** Clamp to the integer 0-100 range a risk_score can occupy. */
export function normalizeThreshold(value) {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, n))
}

/** Recognise "the table isn't there yet" from PostgREST's error shape. */
function isMissingTable(error) {
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    /could not find the table|does not exist/i.test(error?.message || '')
  )
}

/**
 * Read the current threshold.
 *
 * Resolves to { threshold, source, detail } rather than throwing: a missing
 * table or an RLS-hidden row is an expected state early in setup, not a crash.
 *   source 'settings' -- read from the table
 *   source 'default'  -- fell back; `detail` says why
 */
export async function fetchThreshold() {
  const fallback = (detail) => ({
    threshold: DEFAULT_FLAG_THRESHOLD,
    source: 'default',
    detail,
  })

  let res
  try {
    res = await supabase
      .from(SETTINGS_TABLE)
      .select('value')
      .eq('key', THRESHOLD_KEY)
      .maybeSingle()
  } catch (err) {
    return fallback(`Could not reach Supabase (${err.message || err}).`)
  }

  if (res.error) {
    if (isMissingTable(res.error)) {
      return fallback(`No "${SETTINGS_TABLE}" table yet — using the built-in default.`)
    }
    return fallback(`Could not read the threshold (${res.error.message}).`)
  }

  if (!res.data) {
    // Either the row is absent, or RLS is hiding it from this role. Both look
    // identical over the REST API, so say so instead of guessing.
    return fallback(
      `No "${THRESHOLD_KEY}" row is visible — it may not be seeded, or RLS may be hiding it.`,
    )
  }

  const parsed = normalizeThreshold(res.data.value)
  if (parsed === null) {
    return fallback(`Stored threshold ${JSON.stringify(res.data.value)} is not a number.`)
  }

  return { threshold: parsed, source: 'settings', detail: null }
}

/**
 * Persist a new threshold. Upserts on `key`, so it works whether or not the row
 * has been seeded. Resolves to { ok, threshold, error }.
 */
export async function saveThreshold(value) {
  const threshold = normalizeThreshold(value)
  if (threshold === null) {
    return { ok: false, threshold: null, error: 'Threshold must be a number between 0 and 100.' }
  }

  const { error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert({ key: THRESHOLD_KEY, value: threshold }, { onConflict: 'key' })

  if (error) {
    if (isMissingTable(error)) {
      return {
        ok: false,
        threshold,
        error: `No "${SETTINGS_TABLE}" table — create it before saving.`,
      }
    }
    // 42501 is RLS refusing the write.
    if (error.code === '42501') {
      return {
        ok: false,
        threshold,
        error: 'Row-level security refused the write — this role cannot update settings.',
      }
    }
    return { ok: false, threshold, error: error.message }
  }

  return { ok: true, threshold, error: null }
}
