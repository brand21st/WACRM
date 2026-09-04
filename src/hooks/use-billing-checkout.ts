'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { intervalPriceSuffix } from '@/lib/billing/interval'
import type { AccountEntitlements, BillingGate, BillingPackage } from '@/lib/billing/types'

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void }
  }
}

export interface BillingCatalog {
  packages: BillingPackage[]
  subscription: AccountEntitlements | null
  gate: BillingGate
}

export const EMPTY_BILLING_GATE: BillingGate = {
  mode: 'ok',
  periodEnd: null,
  packageName: null,
}

export function formatBillingPrice(pkg: BillingPackage) {
  if (pkg.isFree || pkg.amountPaise === 0) return 'Free'
  const rupees = pkg.amountPaise / 100
  return `₹${rupees.toLocaleString('en-IN')}/${intervalPriceSuffix(pkg.interval)}`
}

export async function loadBillingCatalog(): Promise<BillingCatalog> {
  const res = await fetch('/api/billing/packages')
  const data = (await res.json().catch(() => ({}))) as Partial<BillingCatalog> & {
    error?: string
  }
  if (!res.ok) {
    throw new Error(data.error ?? 'Failed to load billing')
  }
  return {
    packages: data.packages ?? [],
    subscription: data.subscription ?? null,
    gate: data.gate ?? EMPTY_BILLING_GATE,
  }
}

export function useBillingCheckout(onSettled?: () => Promise<void> | void) {
  const [busy, setBusy] = useState<string | null>(null)

  const subscribe = useCallback(
    async (pkg: BillingPackage) => {
      setBusy(pkg.id)
      try {
        const res = await fetch('/api/billing/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ packageId: pkg.id }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          error?: string
          activated?: boolean
          checkout?: Record<string, unknown>
        }
        if (!res.ok) {
          toast.error(data.error ?? 'Checkout failed')
          return
        }
        if (data.activated) {
          toast.success('Plan updated')
          await onSettled?.()
          return
        }
        if (!data.checkout || !window.Razorpay) {
          toast.error('Razorpay Checkout is not available')
          return
        }
        const checkout = new window.Razorpay({
          ...data.checkout,
          handler: async (response: {
            razorpay_subscription_id: string
            razorpay_payment_id: string
            razorpay_signature: string
          }) => {
            await fetch('/api/billing/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(response),
            })
            toast.success('Payment received — activating your plan')
            await onSettled?.()
          },
        })
        checkout.open()
      } finally {
        setBusy(null)
      }
    },
    [onSettled],
  )

  const cancel = useCallback(async () => {
    setBusy('cancel')
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' })
      if (!res.ok) toast.error('Could not cancel')
      else {
        toast.success('Cancellation scheduled at period end')
        await onSettled?.()
      }
    } finally {
      setBusy(null)
    }
  }, [onSettled])

  return { busy, subscribe, cancel }
}
