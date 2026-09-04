'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '@/hooks/use-auth'
import {
  EMPTY_BILLING_GATE,
  loadBillingCatalog,
} from '@/hooks/use-billing-checkout'
import type { AccountEntitlements, BillingGate, BillingPackage } from '@/lib/billing/types'
import { BillingDueBanner } from './billing-due-banner'
import { BillingLockOverlay } from './billing-lock-overlay'

function dismissKey(accountId: string, periodEnd: string | null) {
  return `wacrm:billing-warn:${accountId}:${periodEnd ?? 'none'}`
}

export function BillingGateHost({
  children,
}: {
  children: (args: { locked: boolean; banner: ReactNode }) => ReactNode
}) {
  const { accountId } = useAuth()
  const [gate, setGate] = useState<BillingGate>(EMPTY_BILLING_GATE)
  const [packages, setPackages] = useState<BillingPackage[]>([])
  const [subscription, setSubscription] = useState<AccountEntitlements | null>(null)
  const [dismissed, setDismissed] = useState(false)

  const load = useCallback(async () => {
    const data = await loadBillingCatalog()
    setPackages(data.packages)
    setSubscription(data.subscription)
    setGate(data.gate)
  }, [])

  useEffect(() => {
    void load().catch(() => {})
  }, [load])

  useEffect(() => {
    if (!accountId || gate.mode !== 'warn') {
      setDismissed(false)
      return
    }
    try {
      setDismissed(sessionStorage.getItem(dismissKey(accountId, gate.periodEnd)) === '1')
    } catch {
      setDismissed(false)
    }
  }, [accountId, gate.mode, gate.periodEnd])

  const dismiss = useCallback(() => {
    if (accountId) {
      try {
        sessionStorage.setItem(dismissKey(accountId, gate.periodEnd), '1')
      } catch {
        // ignore
      }
    }
    setDismissed(true)
  }, [accountId, gate.periodEnd])

  const locked = gate.mode === 'lock'
  const banner =
    gate.mode === 'warn' && !dismissed && !locked ? (
      <BillingDueBanner
        packageName={gate.packageName}
        periodEnd={gate.periodEnd}
        onClose={dismiss}
      />
    ) : null

  return (
    <>
      {children({ locked, banner })}
      {locked ? (
        <BillingLockOverlay
          gate={gate}
          packages={packages}
          subscription={subscription}
          onPaid={load}
        />
      ) : null}
    </>
  )
}
