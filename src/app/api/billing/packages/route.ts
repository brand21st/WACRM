import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import {
  BILLING_PACKAGE_COLUMNS,
  getAccountEntitlements,
  loadAccountBillingGate,
  mapPackageRow,
} from '@/lib/billing/entitlements'

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [{ data, error }, entitlements, gate] = await Promise.all([
      supabase
        .from('billing_packages')
        .select(BILLING_PACKAGE_COLUMNS)
        .eq('is_active', true)
        .order('sort_order')
        .order('name'),
      getAccountEntitlements(accountId),
      loadAccountBillingGate(accountId),
    ])
    if (error) {
      return NextResponse.json({ error: 'Failed to load packages' }, { status: 500 })
    }
    return NextResponse.json({
      packages: (data ?? []).map((row) => mapPackageRow(row)),
      subscription: entitlements,
      gate,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
