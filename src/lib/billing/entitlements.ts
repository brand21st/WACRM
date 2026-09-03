import { supabaseAdmin } from '@/lib/ai/admin-client'
import { parseBillingInterval } from './interval'
import {
  FALLBACK_ENTITLEMENTS,
  type AccountEntitlements,
  type BillingInterval,
  type BillingPackage,
  type SubscriptionStatus,
} from './types'

export interface PackageRow {
  id: string
  name: string
  slug: string
  description: string | null
  interval: BillingInterval
  amount_paise: number
  currency: string
  is_active: boolean
  is_free: boolean
  sort_order: number
  razorpay_plan_id: string | null
  ai_enabled: boolean
  ai_monthly_token_cap: number | null
  max_seats: number
  calling_enabled: boolean
  call_recording_enabled?: boolean
  call_forwarding_enabled?: boolean
  whatsapp_enabled: boolean
  whatsapp_monthly_message_cap: number | null
  shopify_enabled: boolean
}

export const BILLING_PACKAGE_COLUMNS =
  'id, name, slug, description, interval, amount_paise, currency, is_active, is_free, sort_order, razorpay_plan_id, ai_enabled, ai_monthly_token_cap, max_seats, calling_enabled, call_recording_enabled, call_forwarding_enabled, whatsapp_enabled, whatsapp_monthly_message_cap, shopify_enabled'

interface SubscriptionRow {
  package_id: string
  status: SubscriptionStatus
  source: 'checkout' | 'comp'
  current_period_end: string | null
  cancel_at_period_end: boolean
  billing_packages: PackageRow | PackageRow[] | null
}

export function mapPackageRow(row: PackageRow): BillingPackage {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    interval: parseBillingInterval(row.interval),
    amountPaise: row.amount_paise,
    currency: row.currency || 'INR',
    isActive: row.is_active,
    isFree: row.is_free,
    sortOrder: row.sort_order,
    razorpayPlanId: row.razorpay_plan_id,
    aiEnabled: row.ai_enabled,
    aiMonthlyTokenCap: row.ai_monthly_token_cap,
    maxSeats: row.max_seats,
    callingEnabled: Boolean(row.calling_enabled),
    callRecordingEnabled: Boolean(row.call_recording_enabled),
    callForwardingEnabled: Boolean(row.call_forwarding_enabled),
    whatsappEnabled: true,
    whatsappMonthlyMessageCap: row.whatsapp_monthly_message_cap,
    shopifyEnabled: Boolean(row.shopify_enabled),
  }
}

export function subscriptionIsLive(
  status: SubscriptionStatus,
  currentPeriodEnd: string | null,
  now = new Date(),
): boolean {
  if (status === 'active' || status === 'past_due') return true
  if (status === 'cancelled' && currentPeriodEnd) {
    return new Date(currentPeriodEnd).getTime() > now.getTime()
  }
  return false
}

function entitlementsFromPackage(
  pkg: PackageRow,
  status: SubscriptionStatus,
  source: AccountEntitlements['source'],
  currentPeriodEnd: string | null,
  cancelAtPeriodEnd: boolean,
): AccountEntitlements {
  return {
    packageId: pkg.id,
    packageName: pkg.name,
    slug: pkg.slug,
    status,
    source,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    aiEnabled: pkg.ai_enabled,
    aiMonthlyTokenCap: pkg.ai_monthly_token_cap,
    maxSeats: pkg.max_seats,
    callingEnabled: Boolean(pkg.calling_enabled),
    callRecordingEnabled: Boolean(pkg.call_recording_enabled),
    callForwardingEnabled: Boolean(pkg.call_forwarding_enabled),
    whatsappEnabled: true,
    whatsappMonthlyMessageCap: pkg.whatsapp_monthly_message_cap,
    shopifyEnabled: Boolean(pkg.shopify_enabled),
  }
}

export async function loadFreePackage(): Promise<PackageRow | null> {
  const { data } = await supabaseAdmin()
    .from('billing_packages')
    .select(BILLING_PACKAGE_COLUMNS)
    .eq('slug', 'free')
    .maybeSingle()
  return (data as PackageRow | null) ?? null
}

export async function getAccountEntitlements(
  accountId: string,
): Promise<AccountEntitlements> {
  const { data, error } = await supabaseAdmin()
    .from('account_subscriptions')
    .select(
      'package_id, status, source, current_period_end, cancel_at_period_end, billing_packages (*)',
    )
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    console.error('[billing] entitlements load failed:', error)
  }

  const row = data as SubscriptionRow | null
  const pkgRaw = row?.billing_packages
  const pkg = Array.isArray(pkgRaw) ? pkgRaw[0] : pkgRaw

  if (row && pkg && subscriptionIsLive(row.status, row.current_period_end)) {
    return entitlementsFromPackage(
      pkg,
      row.status,
      row.source,
      row.current_period_end,
      row.cancel_at_period_end,
    )
  }

  const free = await loadFreePackage()
  if (free) {
    return entitlementsFromPackage(free, 'active', 'comp', null, false)
  }
  return { ...FALLBACK_ENTITLEMENTS }
}

export async function countAccountSeats(accountId: string): Promise<number> {
  const db = supabaseAdmin()
  const [{ count: members }, { count: invites }] = await Promise.all([
    db
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
    db
      .from('account_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString()),
  ])
  return (members ?? 0) + (invites ?? 0)
}

export function startOfUtcMonth(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function countMonthlyOutboundMessages(
  accountId: string,
  now = new Date(),
): Promise<number> {
  const { count } = await supabaseAdmin()
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .in('sender_type', ['agent', 'bot'])
    .gte('created_at', startOfUtcMonth(now).toISOString())
  return count ?? 0
}

export async function countMonthlyAiTokens(
  accountId: string,
  now = new Date(),
): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .from('ai_usage_log')
    .select('total_tokens')
    .eq('account_id', accountId)
    .gte('created_at', startOfUtcMonth(now).toISOString())
  if (error || !data) return 0
  return data.reduce((sum, row) => sum + (row.total_tokens ?? 0), 0)
}

export class EntitlementError extends Error {
  readonly status = 403 as const
  readonly code = 'plan_required'
  constructor(message = 'Upgrade your plan to use this feature') {
    super(message)
    this.name = 'EntitlementError'
  }
}

export class QuotaError extends Error {
  readonly status = 429 as const
  readonly code = 'plan_quota'
  constructor(message = 'This plan’s monthly quota is used up') {
    super(message)
    this.name = 'QuotaError'
  }
}

export async function assertWhatsAppConnect(_accountId: string): Promise<void> {
  // Inbox connect is included on every plan.
}

export async function assertShopifyConnect(accountId: string): Promise<void> {
  const ent = await getAccountEntitlements(accountId)
  if (!ent.shopifyEnabled) {
    throw new EntitlementError('Your plan does not include Shopify')
  }
}

export async function assertCalling(accountId: string): Promise<void> {
  const ent = await getAccountEntitlements(accountId)
  if (!ent.callingEnabled) {
    throw new EntitlementError('Your plan does not include Live calling AI')
  }
}

export async function assertCallRecording(accountId: string): Promise<void> {
  const ent = await getAccountEntitlements(accountId)
  if (!ent.callRecordingEnabled) {
    throw new EntitlementError('Your plan does not include WhatsApp Call Recording')
  }
}

export async function assertCallForwarding(accountId: string): Promise<void> {
  const ent = await getAccountEntitlements(accountId)
  if (!ent.callForwardingEnabled) {
    throw new EntitlementError('Your plan does not include Call team forwarding')
  }
}

export async function assertSeatAvailable(accountId: string): Promise<void> {
  const ent = await getAccountEntitlements(accountId)
  const used = await countAccountSeats(accountId)
  if (used >= ent.maxSeats) {
    throw new EntitlementError(
      `This plan allows ${ent.maxSeats} team seat${ent.maxSeats === 1 ? '' : 's'}`,
    )
  }
}

export async function assertWhatsAppSend(accountId: string): Promise<void> {
  const ent = await getAccountEntitlements(accountId)
  if (ent.whatsappMonthlyMessageCap == null) return
  const used = await countMonthlyOutboundMessages(accountId)
  if (used >= ent.whatsappMonthlyMessageCap) {
    throw new QuotaError('This plan’s monthly WhatsApp message cap is used up')
  }
}

export async function accountMayUseAi(accountId: string): Promise<boolean> {
  const ent = await getAccountEntitlements(accountId)
  if (!ent.aiEnabled) return false
  if (ent.aiMonthlyTokenCap == null) return true
  const used = await countMonthlyAiTokens(accountId)
  return used < ent.aiMonthlyTokenCap
}
