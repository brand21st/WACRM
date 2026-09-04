'use client';

import { useCallback, useEffect, useState } from 'react';
import Script from 'next/script';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCan } from '@/hooks/use-can';
import {
  formatBillingPrice,
  loadBillingCatalog,
  useBillingCheckout,
} from '@/hooks/use-billing-checkout';
import type { AccountEntitlements, BillingPackage } from '@/lib/billing/types';

export function BillingPanel() {
  const canEdit = useCan('edit-settings');
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [sub, setSub] = useState<AccountEntitlements | null>(null);

  const load = useCallback(async () => {
    const data = await loadBillingCatalog();
    setPackages(data.packages);
    setSub(data.subscription);
  }, []);

  useEffect(() => {
    void load().catch(() => {});
  }, [load]);

  const { busy, subscribe, cancel } = useBillingCheckout(load);

  return (
    <div className="space-y-6">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current plan</CardTitle>
          <CardDescription>
            {sub
              ? `${sub.packageName} · ${sub.status}${
                  sub.currentPeriodEnd
                    ? ` · renews ${new Date(sub.currentPeriodEnd).toLocaleDateString()}`
                    : ''
                }`
              : 'Loading…'}
          </CardDescription>
        </CardHeader>
        {sub && !sub.slug.includes('free') && canEdit ? (
          <CardContent>
            <Button variant="outline" onClick={() => void cancel()} disabled={busy === 'cancel'}>
              Cancel at period end
            </Button>
          </CardContent>
        ) : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {packages.map((pkg) => {
          const current = sub?.packageId === pkg.id;
          return (
            <Card key={pkg.id}>
              <CardHeader>
                <CardTitle className="text-base">{pkg.name}</CardTitle>
                <CardDescription>{formatBillingPrice(pkg)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {pkg.description || '—'}
                </p>
                <ul className="text-sm text-muted-foreground">
                  <li>{pkg.maxSeats} team seats</li>
                  <li>Live calling AI {pkg.callingEnabled ? 'included' : 'not included'}</li>
                  <li>Call recording {pkg.callRecordingEnabled ? 'included' : 'not included'}</li>
                  <li>Call team forwarding {pkg.callForwardingEnabled ? 'included' : 'not included'}</li>
                  <li>AI {pkg.aiEnabled ? 'included' : 'not included'}</li>
                  <li>Shopify {pkg.shopifyEnabled ? 'included' : 'not included'}</li>
                </ul>
                <Button
                  disabled={!canEdit || current || busy === pkg.id}
                  onClick={() => void subscribe(pkg)}
                >
                  {current ? 'Current plan' : pkg.isFree ? 'Switch to Free' : 'Subscribe'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
