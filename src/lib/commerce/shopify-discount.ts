import { shopifyGraphql, ShopifyError } from '@/lib/shopify/client'
import type { ShopifyStoreConfig } from '@/lib/shopify/types'
import { paiseFromMajor } from './money'
import { variantGid } from './shopify-order'
import type { MappedCartLine } from './types'

export const DISCOUNT_BY_CODE_QUERY = `
query WhatsAppDiscountByCode($code: String!) {
  codeDiscountNodeByCode(code: $code) {
    id
    codeDiscount {
      __typename
      ... on DiscountCodeBasic {
        status
        startsAt
        endsAt
        usageLimit
        asyncUsageCount
        customerGets {
          value {
            ... on DiscountPercentage {
              percentage
            }
            ... on DiscountAmount {
              amount {
                amount
                currencyCode
              }
              appliesOnEachItem
            }
          }
          items {
            ... on AllDiscountItems {
              allItems
            }
            ... on DiscountProducts {
              products(first: 50) {
                nodes { id }
              }
              productVariants(first: 50) {
                nodes { id }
              }
            }
            ... on DiscountCollections {
              collections(first: 1) {
                nodes { id }
              }
            }
          }
        }
        minimumRequirement {
          ... on DiscountMinimumQuantity {
            greaterThanOrEqualToQuantity
          }
          ... on DiscountMinimumSubtotal {
            greaterThanOrEqualToSubtotal {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
}
`

export interface AppliedCommerceDiscount {
  code: string
  kind: 'percentage' | 'fixed'
  /** 0–100, for Shopify orderCreate percentage discounts. */
  percent: number | null
  amountPaise: number
}

export type DiscountLookupResult =
  | { ok: true; discount: AppliedCommerceDiscount }
  | { ok: false; reason: 'invalid' | 'unsupported' | 'unavailable' }

interface DiscountNodePayload {
  codeDiscountNodeByCode?: {
    codeDiscount?: Record<string, unknown> | null
  } | null
}

/**
 * Look up a Shopify code and compute the rupee amount for this cart.
 * `unavailable` means we could not talk to Shopify (missing scope,
 * token, network) — callers should bill the full amount rather than
 * block checkout.
 */
export async function lookupShopifyDiscountCode(args: {
  config: ShopifyStoreConfig
  code: string
  lines: MappedCartLine[]
  now?: Date
}): Promise<DiscountLookupResult> {
  const code = args.code.trim()
  if (!code) return { ok: false, reason: 'invalid' }
  let data: DiscountNodePayload
  try {
    data = await shopifyGraphql<DiscountNodePayload>({
      shopDomain: args.config.shopDomain,
      accessToken: args.config.accessToken,
      query: DISCOUNT_BY_CODE_QUERY,
      variables: { code },
    })
  } catch (err) {
    const message = err instanceof ShopifyError ? err.message : String(err)
    if (err instanceof ShopifyError && err.code === 'invalid_token') {
      return { ok: false, reason: 'unavailable' }
    }
    if (/access denied|read_discounts|not approved/i.test(message)) {
      return { ok: false, reason: 'unavailable' }
    }
    console.warn('[commerce] discount lookup failed:', err)
    return { ok: false, reason: 'unavailable' }
  }

  const node = data.codeDiscountNodeByCode?.codeDiscount
  if (!node) return { ok: false, reason: 'invalid' }
  return applyDiscountNodeToCart({
    code,
    node,
    lines: args.lines,
    now: args.now ?? new Date(),
  })
}

export function applyDiscountNodeToCart(args: {
  code: string
  node: Record<string, unknown>
  lines: MappedCartLine[]
  now: Date
}): DiscountLookupResult {
  const typename = String(args.node.__typename ?? '')
  if (typename && typename !== 'DiscountCodeBasic') {
    return { ok: false, reason: 'unsupported' }
  }
  if (String(args.node.status ?? '') !== 'ACTIVE') {
    return { ok: false, reason: 'invalid' }
  }
  const startsAt = parseTime(args.node.startsAt)
  if (startsAt && startsAt.getTime() > args.now.getTime()) {
    return { ok: false, reason: 'invalid' }
  }
  const endsAt = parseTime(args.node.endsAt)
  if (endsAt && endsAt.getTime() <= args.now.getTime()) {
    return { ok: false, reason: 'invalid' }
  }
  const usageLimit = asFiniteNumber(args.node.usageLimit)
  const used = asFiniteNumber(args.node.asyncUsageCount) ?? 0
  if (usageLimit != null && used >= usageLimit) {
    return { ok: false, reason: 'invalid' }
  }

  const customerGets = asRecord(args.node.customerGets)
  const items = asRecord(customerGets?.items)
  const eligible = eligibleLines(args.lines, items)
  if (eligible.length === 0) return { ok: false, reason: 'invalid' }

  const eligibleQty = eligible.reduce((sum, line) => sum + line.quantity, 0)
  const eligibleSubtotal = eligible.reduce(
    (sum, line) => sum + line.amountPaise * line.quantity,
    0,
  )
  const cartQty = args.lines.reduce((sum, line) => sum + line.quantity, 0)
  const cartSubtotal = args.lines.reduce(
    (sum, line) => sum + line.amountPaise * line.quantity,
    0,
  )

  const minimum = asRecord(args.node.minimumRequirement)
  if (minimum) {
    const minQty = asFiniteNumber(minimum.greaterThanOrEqualToQuantity)
    if (minQty != null && cartQty < minQty) {
      return { ok: false, reason: 'invalid' }
    }
    const minSubtotal = asRecord(minimum.greaterThanOrEqualToSubtotal)
    const minPaise = paiseFromMajor(String(minSubtotal?.amount ?? ''))
    if (minPaise > 0 && cartSubtotal < minPaise) {
      return { ok: false, reason: 'invalid' }
    }
  }

  const value = asRecord(customerGets?.value)
  if (!value) return { ok: false, reason: 'unsupported' }

  const percentageRaw = asFiniteNumber(value.percentage)
  if (percentageRaw != null && percentageRaw > 0) {
    const percent = percentageRaw <= 1 ? percentageRaw * 100 : percentageRaw
    const amountPaise = Math.min(
      eligibleSubtotal,
      Math.round(eligibleSubtotal * (percent / 100)),
    )
    if (amountPaise <= 0) return { ok: false, reason: 'invalid' }
    return {
      ok: true,
      discount: {
        code: args.code,
        kind: 'percentage',
        percent,
        amountPaise,
      },
    }
  }

  const amount = asRecord(value.amount)
  const unitPaise = paiseFromMajor(String(amount?.amount ?? ''))
  if (unitPaise > 0) {
    const each = Boolean(value.appliesOnEachItem)
    const amountPaise = Math.min(
      eligibleSubtotal,
      each ? unitPaise * eligibleQty : unitPaise,
    )
    if (amountPaise <= 0) return { ok: false, reason: 'invalid' }
    return {
      ok: true,
      discount: {
        code: args.code,
        kind: 'fixed',
        percent: null,
        amountPaise,
      },
    }
  }

  return { ok: false, reason: 'unsupported' }
}

function eligibleLines(
  lines: MappedCartLine[],
  items: Record<string, unknown> | null,
): MappedCartLine[] {
  if (!items) return []
  if (items.allItems === true) return lines
  const products = idSet(items.products)
  const variants = idSet(items.productVariants)
  const collections = idSet(items.collections)
  if (collections.size > 0 && products.size === 0 && variants.size === 0) {
    // Collection-only codes need extra product lookups we do not do
    // on the WhatsApp path.
    return []
  }
  if (products.size === 0 && variants.size === 0) return []
  return lines.filter((line) => {
    const variantId = variantGid(line.variantId)
    const productId = line.productId.startsWith('gid://')
      ? line.productId
      : `gid://shopify/Product/${line.productId}`
    return variants.has(variantId) || products.has(productId)
  })
}

function idSet(connection: unknown): Set<string> {
  const record = asRecord(connection)
  const nodes = record?.nodes
  if (!Array.isArray(nodes)) return new Set()
  return new Set(
    nodes
      .map((node) => asRecord(node)?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
