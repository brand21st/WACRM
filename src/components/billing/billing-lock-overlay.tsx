'use client'

import Script from 'next/script'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useCan } from '@/hooks/use-can'
import {
  formatBillingPrice,
  useBillingCheckout,
} from '@/hooks/use-billing-checkout'
import type { AccountEntitlements, BillingGate, BillingPackage } from '@/lib/billing/types'

export function BillingLockOverlay({
  gate,
  packages,
  subscription,
  onPaid,
}: {
  gate: BillingGate
  packages: BillingPackage[]
  subscription: AccountEntitlements | null
  onPaid: () => Promise<void> | void
}) {
  const t = useTranslations('BillingGate')
  const canPay = useCan('edit-settings')
  const { busy, subscribe } = useBillingCheckout(onPaid)

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/60 p-4 backdrop-blur-md sm:p-8">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <div className="my-auto w-full max-w-3xl space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl sm:p-6">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t('lockTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('lockBody', {
              plan: gate.packageName || t('fallbackPlan'),
              date: gate.periodEnd ? new Date(gate.periodEnd).toLocaleDateString() : '—',
            })}
          </p>
          {!canPay ? <p className="mt-2 text-sm text-muted-foreground">{t('askAdmin')}</p> : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {packages.map((pkg) => {
            const current = subscription?.packageId === pkg.id
            return (
              <Card key={pkg.id}>
                <CardHeader>
                  <CardTitle className="text-base">{pkg.name}</CardTitle>
                  <CardDescription>{formatBillingPrice(pkg)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{pkg.description || '—'}</p>
                  <ul className="text-sm text-muted-foreground">
                    <li>{t('seats', { count: pkg.maxSeats })}</li>
                    <li>AI {pkg.aiEnabled ? t('included') : t('notIncluded')}</li>
                    <li>Shopify {pkg.shopifyEnabled ? t('included') : t('notIncluded')}</li>
                  </ul>
                  <Button
                    className="w-full"
                    disabled={!canPay || busy === pkg.id}
                    onClick={() => void subscribe(pkg)}
                  >
                    {pkg.isFree
                      ? t('switchFree')
                      : current
                        ? t('payNow')
                        : t('subscribe')}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
