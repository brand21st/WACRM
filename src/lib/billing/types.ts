export type BillingInterval = 'month' | 'quarter' | 'year'
export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'expired'
export type SubscriptionSource = 'checkout' | 'comp'
export type BillingGateMode = 'ok' | 'warn' | 'lock'

export interface BillingGate {
  mode: BillingGateMode
  periodEnd: string | null
  packageName: string | null
}

export interface BillingGateInput {
  status: SubscriptionStatus
  source: SubscriptionSource
  currentPeriodEnd: string | null
  packageName: string | null
  isFree: boolean
  amountPaise: number
  accountStatus?: 'active' | 'hold' | 'suspended'
}

export interface BillingPackage {
  id: string
  name: string
  slug: string
  description: string | null
  interval: BillingInterval
  amountPaise: number
  currency: string
  isActive: boolean
  isFree: boolean
  sortOrder: number
  razorpayPlanId: string | null
  aiEnabled: boolean
  aiMonthlyTokenCap: number | null
  maxSeats: number
  callingEnabled: boolean
  callRecordingEnabled: boolean
  callForwardingEnabled: boolean
  whatsappEnabled: boolean
  whatsappMonthlyMessageCap: number | null
  shopifyEnabled: boolean
}

export interface AccountEntitlements {
  packageId: string | null
  packageName: string
  slug: string
  status: SubscriptionStatus
  source: SubscriptionSource
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  aiEnabled: boolean
  aiMonthlyTokenCap: number | null
  maxSeats: number
  callingEnabled: boolean
  callRecordingEnabled: boolean
  callForwardingEnabled: boolean
  whatsappEnabled: boolean
  whatsappMonthlyMessageCap: number | null
  shopifyEnabled: boolean
}

export const FALLBACK_ENTITLEMENTS: AccountEntitlements = {
  packageId: null,
  packageName: 'Free',
  slug: 'free',
  status: 'expired',
  source: 'comp',
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  aiEnabled: false,
  aiMonthlyTokenCap: null,
  maxSeats: 1,
  callingEnabled: false,
  callRecordingEnabled: false,
  callForwardingEnabled: false,
  whatsappEnabled: true,
  whatsappMonthlyMessageCap: null,
  shopifyEnabled: false,
}
