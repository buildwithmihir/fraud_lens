import React, { useMemo } from 'react'
import RiskPolicyPanel from './RiskPolicyPanel'
import AdminThresholds from './AdminThresholds'
import AuditTrail from './AuditTrail'
import CreateTransaction from './CreateTransaction'

export default function AdminSettings({ transactions = [] }) {
  // One entry per user, from the joined profiles already in hand.
  const users = useMemo(() => {
    const byId = new Map()
    for (const t of transactions) {
      if (!byId.has(t.userId)) byId.set(t.userId, t.user)
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [transactions])

  return (
    <div className="grid grid-cols-2 gap-4 items-start">
      <div className="space-y-4">
        <AdminThresholds transactions={transactions} />
        <RiskPolicyPanel />
      </div>
      <div className="space-y-4">
        <CreateTransaction users={users} />
        <AuditTrail />
      </div>
    </div>
  )
}
