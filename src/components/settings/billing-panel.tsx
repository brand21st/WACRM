'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCan } from '@/hooks/use-can';
import { intervalPriceSuffix } from '@/lib/billing/interval';
import type { AccountEntitlements, BillingPackage } from '@/lib/billing/types';

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function formatPrice(pkg: BillingPackage) {
  if (pkg.isFree || pkg.amountPaise === 0) return 'Free';
  const rupees = pkg.amountPaise / 100;
  return `₹${rupees.toLocaleString('en-IN')}/${intervalPriceSuffix(pkg.interval)}`;
}

export function BillingPanel() {
  const canEdit = useCan('edit-settings');
  const [packages, setPackages] = useState<BillingPackage[]>([]);
  const [sub, setSub] = useState<AccountEntitlements | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/api/billing/packages');
    const data = await res.json();
    setPackages(data.packages ?? []);
    setSub(data.subscription ?? null);
  }

  useEffect(() => {
    void load();
  }, []);

  async function subscribe(pkg: BillingPackage) {
    if (!canEdit) return;
    setBusy(pkg.id);
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? 'Checkout failed');
        return;
      }
      if (data.activated) {
        toast.success('Plan updated');
        await load();
        return;
      }
      if (!data.checkout || !window.Razorpay) {
        toast.error('Razorpay Checkout is not available');
        return;
      }
      const checkout = new window.Razorpay({
        ...data.checkout,
        handler: async (response: {
          razorpay_subscription_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          await fetch('/api/billing/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(response),
          });
          toast.success('Payment received — activating your plan');
          await load();
        },
      });
      checkout.open();
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    setBusy('cancel');
    try {
      const res = await fetch('/api/billing/cancel', { method: 'POST' });
      if (!res.ok) toast.error('Could not cancel');
      else {
        toast.success('Cancellation scheduled at period end');
        await load();
      }
    } finally {
      setBusy(null);
    }
  }

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
                <CardDescription>{formatPrice(pkg)}</CardDescription>
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
