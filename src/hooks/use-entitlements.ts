'use client'

import { useEffect, useState } from 'react'

import type { AccountEntitlements } from '@/lib/billing/types'

export function useEntitlements() {
  const [entitlements, setEntitlements] = useState<AccountEntitlements | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/billing/packages', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { subscription?: AccountEntitlements } | null) => {
        if (!cancelled && data?.subscription) setEntitlements(data.subscription)
      })
      .catch(() => {
        if (!cancelled) setEntitlements(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { entitlements, loading }
}
