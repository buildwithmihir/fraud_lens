/**
 * Supabase reads for the dashboard.
 *
 * The dashboard talks to Supabase directly with the anon key; there is no
 * backend in the path (backend/ is unimplemented). Everything is read-only --
 * scoring and write-back live in model/score_transaction.py.
 *
 * The whole dataset is 393 transactions / 15 users / 4 transfers, so we fetch it
 * once and derive per-user history and mule chains client-side rather than
 * issuing a query per selected row.
 */

import { supabase } from './supabaseClient'
import { RULES, firedFromEvidence } from './risk'

const TXN_SELECT = `
  id, user_id, timestamp, amount, location, device_id,
  risk_score, status, evidence_for, evidence_against, is_new_device,
  users ( name, account_created_at, avg_transaction_amount,
          typical_locations, known_devices )
`

const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v])

/** Whole years between a date column and now, one decimal. */
function accountAgeYears(createdAt) {
  if (!createdAt) return null
  const then = new Date(createdAt)
  if (Number.isNaN(then.getTime())) return null
  return (Date.now() - then.getTime()) / (365.25 * 24 * 3600 * 1000)
}

/**
 * Which rules fired, reconstructed from the evidence the scorer wrote.
 * Lives in lib/risk.js alongside the weights it has to stay consistent with.
 */
function firedRules(evidenceFor) {
  return firedFromEvidence(evidenceFor)
}

function adaptTransaction(row) {
  const user = row.users || {}
  const ageYears = accountAgeYears(user.account_created_at)
  // A stored 0 means "the scorer ran and all four rules passed" -- it is a real
  // result, backed by four evidence_against entries. A missing risk_score would
  // also coerce to 0, which would render as an innocuous normal row, so the two
  // are distinguished explicitly. Every seeded row is scored today (0 nulls
  // across all 393), so `scored` is false only for a row inserted without a
  // score, before score_transaction.py has run over it.
  const scored = row.risk_score !== null && row.risk_score !== undefined
  return {
    id: row.id,
    shortId: `TX-${String(row.id).slice(0, 6).toUpperCase()}`,
    userId: row.user_id,
    timestamp: row.timestamp,
    amount: Number(row.amount) || 0,
    location: row.location,
    deviceId: row.device_id,
    scored,
    risk: scored ? Number(row.risk_score) : 0,
    status: row.status,
    isNewDevice: row.is_new_device === true,
    evidenceFor: asArray(row.evidence_for),
    evidenceAgainst: asArray(row.evidence_against),
    fired: firedRules(row.evidence_for),
    user: {
      id: row.user_id,
      name: user.name || 'Unknown user',
      accountAgeYears: ageYears,
      accountAge: ageYears == null ? '--' : `${ageYears.toFixed(1)} yrs`,
      avgSpend: Number(user.avg_transaction_amount) || 0,
      knownDevices: asArray(user.known_devices).length,
      typicalLocations: asArray(user.typical_locations),
    },
  }
}

/**
 * Rebuild a mule chain from its transfer rows.
 *
 * The live schema dropped chain_id/hop/from_label/to_label (see
 * model/seed_supabase.py MAPPING_NOTES), so hop order comes from the timestamp
 * and the chain is walked from_account -> to_account.
 */
function buildChain(transfers) {
  const hops = [...transfers].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  if (!hops.length) return null
  const accounts = [hops[0].from_account, ...hops.map((h) => h.to_account)]
  const total = hops.reduce((sum, h) => sum + (Number(h.amount) || 0), 0)
  const span = (new Date(hops[hops.length - 1].timestamp) - new Date(hops[0].timestamp)) / 60000
  return {
    accounts,
    hops: hops.length,
    total,
    note:
      hops.length > 1
        ? `${hops.length} hops over ${span < 1 ? '<1' : Math.round(span)} min`
        : '1 hop',
  }
}

/** Everything the dashboard needs, in one round trip per table. */
export async function fetchDashboardData() {
  const [txnRes, trfRes] = await Promise.all([
    supabase
      .from('transactions')
      .select(TXN_SELECT)
      .order('risk_score', { ascending: false })
      .order('timestamp', { ascending: false }),
    supabase.from('transfers').select('*'),
  ])

  if (txnRes.error) throw new Error(`transactions: ${txnRes.error.message}`)
  if (trfRes.error) throw new Error(`transfers: ${trfRes.error.message}`)

  const transactions = (txnRes.data || []).map(adaptTransaction)

  // user_id -> their transactions, oldest first (the sparkline's x order)
  const historyByUser = {}
  for (const t of transactions) {
    ;(historyByUser[t.userId] ||= []).push(t)
  }
  for (const list of Object.values(historyByUser)) {
    list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  }

  // linked transaction -> its chain
  const grouped = {}
  for (const tr of trfRes.data || []) {
    ;(grouped[tr.linked_transaction_id] ||= []).push(tr)
  }
  const chainByTxn = {}
  for (const [txnId, rows] of Object.entries(grouped)) {
    chainByTxn[txnId] = buildChain(rows)
  }

  return { transactions, historyByUser, chainByTxn, ruleKeys: RULES.map((r) => r.key) }
}
