import type { SupabaseClient } from '@supabase/supabase-js'
import { shopifyGraphql } from './client'
import { CUSTOMERS_BY_QUERY, ORDERS_BY_QUERY } from './queries'
import { getProductLive, listNewArrivals, searchProducts } from './catalog'
import { matchProductsFromPhoto } from './match-photo'
import { searchStoreContent } from './store-content'
import { customerSearchQueries, shopifyPhoneMatchesContact } from './phone'
import type {
  ShopifyOrderHit,
  ShopifyProductCard,
  ShopifyProductHit,
  ShopifyStoreConfig,
} from './types'
import type { LlmToolDef } from '@/lib/ai/providers/shared'

export const SHOPIFY_LLM_TOOLS: LlmToolDef[] = [
  {
    name: 'search_products',
    description:
      'Search the Shopify catalog for products by name, color, brand, or keywords. Use for prices, variants, and product details. Never invent products.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text, e.g. "red leather bag" or a SKU',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_product',
    description: 'Fetch one Shopify product by handle, product id, or SKU.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Product handle, numeric id, GID, or SKU',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_new_arrivals',
    description: 'List the newest published products in the Shopify catalog.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many to return (1–8)' },
      },
    },
  },
  {
    name: 'match_product_from_photo',
    description:
      'Match a customer product photo against the Shopify catalog using a vision description (item type, color, brand, pattern, text on the item). Returns the closest 1–3 products.',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Searchable description of what is in the photo',
        },
      },
      required: ['description'],
    },
  },
  {
    name: 'search_store_info',
    description:
      'Search synced Shopify website content: policies (privacy, refund, shipping/delivery time, terms), About, Contact, FAQ, and other Online Store pages. Use when the customer asks about delivery time, shipping, returns, the business, policies, hours, or contact details. Never invent policies.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'e.g. "delivery time", "shipping", "return policy", "about us"',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'lookup_my_orders',
    description:
      'Look up this WhatsApp customer’s Shopify orders. Always uses the contact phone; never other customers. Optional order name like #1001.',
    parameters: {
      type: 'object',
      properties: {
        order_name: {
          type: 'string',
          description: 'Optional order name such as #1001',
        },
      },
    },
  },
  {
    name: 'get_order_tracking',
    description:
      'Get shipment tracking for this WhatsApp customer’s order (phone-gated).',
    parameters: {
      type: 'object',
      properties: {
        order_name: {
          type: 'string',
          description: 'Order name such as #1001',
        },
      },
    },
  },
]

export interface ShopifyToolContext {
  db: SupabaseClient
  config: ShopifyStoreConfig
  contactPhone: string | null
}

export interface ShopifyToolResult {
  json: string
  cards: ShopifyProductCard[]
}

export async function executeShopifyTool(
  ctx: ShopifyToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ShopifyToolResult> {
  try {
    switch (name) {
      case 'search_products':
        return productsResult(
          await searchProducts(ctx.db, ctx.config, str(args.query)),
        )
      case 'get_product': {
        const hit = await getProductLive(ctx.config, str(args.id))
        return productsResult(hit ? [hit] : [])
      }
      case 'list_new_arrivals': {
        const limit = clampInt(args.limit, 1, 8, 6)
        return productsResult(await listNewArrivals(ctx.db, ctx.config, limit))
      }
      case 'match_product_from_photo': {
        return productsResult(
          await matchProductsFromPhoto(
            ctx.db,
            ctx.config,
            str(args.description),
          ),
        )
      }
      case 'search_store_info': {
        const hits = await searchStoreContent(
          ctx.db,
          ctx.config.accountId,
          str(args.query),
          5,
        )
        if (hits.length === 0) {
          return {
            json: JSON.stringify({
              pages: [],
              note: 'No matching store pages or policies. Do not invent policies or business facts.',
            }),
            cards: [],
          }
        }
        return {
          json: JSON.stringify({
            pages: hits.map((h) => ({
              kind: h.kind,
              title: h.title,
              handle: h.handle,
              url: h.pageUrl,
              body: h.body.slice(0, 1200),
            })),
          }),
          cards: [],
        }
      }
      case 'lookup_my_orders':
        return {
          json: JSON.stringify(
            await lookupOrders(ctx, str(args.order_name) || undefined),
          ),
          cards: [],
        }
      case 'get_order_tracking':
        return {
          json: JSON.stringify(
            await lookupOrders(ctx, str(args.order_name) || undefined, true),
          ),
          cards: [],
        }
      default:
        return { json: JSON.stringify({ error: `Unknown tool: ${name}` }), cards: [] }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { json: JSON.stringify({ error: message }), cards: [] }
  }
}

function productsResult(hits: ShopifyProductHit[]): ShopifyToolResult {
  if (hits.length === 0) {
    return {
      json: JSON.stringify({
        products: [],
        note: 'No matching products in the Shopify catalog. Do not invent items.',
      }),
      cards: [],
    }
  }
  return {
    json: JSON.stringify({ products: hits.map(summarizeProduct) }),
    cards: hits.slice(0, 3).map(toCard),
  }
}

function summarizeProduct(p: ShopifyProductHit) {
  return {
    title: p.title,
    handle: p.handle,
    price_min: p.priceMin,
    price_max: p.priceMax,
    currency: p.currency,
    product_url: p.productUrl,
    cart_url: p.cartUrl,
    checkout_url: p.checkoutUrl,
    variants: p.variants.slice(0, 8).map((v) => ({
      title: v.title,
      sku: v.sku,
      price: v.price,
      available: v.available,
      options: v.options.map((o) => `${o.name}: ${o.value}`),
      cart_url: p.productUrl
        ? p.cartUrl && v.variantId
          ? p.cartUrl.replace(/\/cart\/[^/]+/, `/cart/${v.variantId}:1`)
          : null
        : null,
    })),
  }
}

export function productInStock(p: ShopifyProductHit): boolean {
  if (p.variants.length === 0) return Boolean(p.checkoutUrl?.trim())
  return p.variants.some((v) => v.available)
}

const PLACEHOLDER_VARIANT = /^(default(?: title)?)$/i
const MAX_VARIANT_LABELS = 8

function optionValue(
  v: ShopifyProductHit['variants'][number],
  name: RegExp,
): string {
  const value = v.options.find((o) => name.test(o.name))?.value.trim() ?? ''
  return value && !PLACEHOLDER_VARIANT.test(value) ? value : ''
}

function uniqueOptionValues(
  variants: ShopifyProductHit['variants'],
  pick: (v: ShopifyProductHit['variants'][number]) => string,
): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const v of variants) {
    const label = pick(v)
    if (!label) continue
    const key = label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    labels.push(label)
  }
  return labels
}

function optionLine(prefix: string, values: string[]): string[] {
  if (values.length === 0) return []
  const shown = values.slice(0, MAX_VARIANT_LABELS)
  const extra = values.length - shown.length
  const list = shown.join(', ') + (extra > 0 ? `, +${extra} more` : '')
  return [`${prefix}: ${list}`]
}

function otherVariantLabel(v: ShopifyProductHit['variants'][number]): string {
  const fromOptions = v.options
    .filter((o) => !/^size$/i.test(o.name) && !/^colou?r$/i.test(o.name))
    .map((o) => o.value.trim())
    .filter((value) => value && !PLACEHOLDER_VARIANT.test(value))
  if (fromOptions.length > 0) return fromOptions.join(' / ')
  const title = v.title.trim()
  if (title && !PLACEHOLDER_VARIANT.test(title)) return title
  return ''
}

function variantCaptionLines(
  variants: ShopifyProductHit['variants'],
): string[] {
  const sizes = uniqueOptionValues(variants, (v) => optionValue(v, /^size$/i))
  const colors = uniqueOptionValues(variants, (v) =>
    optionValue(v, /^colou?r$/i),
  )
  const other =
    sizes.length === 0 && colors.length === 0
      ? uniqueOptionValues(variants, otherVariantLabel)
      : []
  return [
    ...optionLine('Variants', sizes.length > 0 ? sizes : other),
    ...optionLine('Color', colors),
  ]
}

export function toCard(p: ShopifyProductHit): ShopifyProductCard {
  const price =
    p.priceMin && p.priceMax && p.priceMin !== p.priceMax
      ? `${p.priceMin}–${p.priceMax}${p.currency ? ` ${p.currency}` : ''}`
      : `${p.priceMin ?? ''}${p.currency ? ` ${p.currency}` : ''}`.trim()
  const inStock = productInStock(p)
  const lines = [
    p.title,
    price,
    inStock ? 'Stock in' : 'Stock out',
    ...variantCaptionLines(p.variants),
    p.productUrl ? `View: ${p.productUrl}` : '',
  ].filter(Boolean)
  return {
    title: p.title,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    cartUrl: p.cartUrl,
    checkoutUrl: p.checkoutUrl,
    inStock,
    caption: lines.join('\n').slice(0, 1024),
  }
}

async function lookupOrders(
  ctx: ShopifyToolContext,
  orderName?: string,
  trackingOnly = false,
): Promise<Record<string, unknown>> {
  if (!ctx.contactPhone) {
    return {
      orders: [],
      note: 'No WhatsApp phone on this contact, so orders cannot be looked up.',
    }
  }

  let orders = await fetchOrdersForPhone(ctx, ctx.contactPhone)
  const needle = orderName?.replace(/^#+/, '').trim()
  if (orders.length === 0 && needle) {
    const named = await lookupOrderByNameForPhone(ctx, needle)
    if (named) orders = [named]
  }
  const filtered = needle
    ? orders.filter(
        (o) =>
          o.name.replace(/^#+/, '') === needle ||
          o.name.toLowerCase() === (orderName || '').trim().toLowerCase(),
      )
    : orders

  if (filtered.length === 0) {
    return {
      orders: [],
      note: 'No orders found for this WhatsApp number. Do not reveal anyone else’s orders.',
    }
  }

  return {
    orders: filtered.map((o) =>
      trackingOnly
        ? {
            name: o.name,
            fulfillment_status: o.fulfillmentStatus,
            tracking: o.tracking,
          }
        : o,
    ),
  }
}

async function fetchOrdersForPhone(
  ctx: ShopifyToolContext,
  contactPhone: string,
): Promise<ShopifyOrderHit[]> {
  const seen = new Set<string>()
  const out: ShopifyOrderHit[] = []

  for (const q of customerSearchQueries(contactPhone)) {
    const data = await shopifyGraphql<{
      customers?: { nodes?: CustomerNode[] }
    }>({
      shopDomain: ctx.config.shopDomain,
      accessToken: ctx.config.accessToken,
      query: CUSTOMERS_BY_QUERY,
      variables: { query: q },
    })
    for (const customer of data.customers?.nodes ?? []) {
      if (
        !shopifyPhoneMatchesContact(contactPhone, [
          customer.phone,
          customer.defaultAddress?.phone,
        ])
      ) {
        continue
      }
      for (const order of customer.orders?.nodes ?? []) {
        if (!order.id || seen.has(order.id)) continue
        seen.add(order.id)
        out.push(mapOrder(order))
      }
    }
    if (out.length > 0) break
  }
  return out
}

/** Phone-gated order lookup by name. Used when customer search missed. */
export async function lookupOrderByNameForPhone(
  ctx: ShopifyToolContext,
  orderName: string,
): Promise<ShopifyOrderHit | null> {
  if (!ctx.contactPhone) return null
  const q = `name:${orderName.replace(/^#+/, '#')}`
  const data = await shopifyGraphql<{ orders?: { nodes?: OrderNode[] } }>({
    shopDomain: ctx.config.shopDomain,
    accessToken: ctx.config.accessToken,
    query: ORDERS_BY_QUERY,
    variables: { query: q.startsWith('name:#') ? q : `name:#${orderName.replace(/^#+/, '')}` },
  })
  for (const order of data.orders?.nodes ?? []) {
    if (
      shopifyPhoneMatchesContact(ctx.contactPhone, [
        order.customer?.phone,
        order.shippingAddress?.phone,
        order.billingAddress?.phone,
      ])
    ) {
      return mapOrder(order)
    }
  }
  return null
}

function mapOrder(order: OrderNode): ShopifyOrderHit {
  const money = order.totalPriceSet?.shopMoney
  return {
    id: order.id || '',
    name: order.name || '',
    financialStatus: order.displayFinancialStatus ?? null,
    fulfillmentStatus: order.displayFulfillmentStatus ?? null,
    createdAt: order.createdAt ?? null,
    total: money?.amount ?? null,
    currency: money?.currencyCode ?? null,
    lineItems: (order.lineItems?.nodes ?? []).map((li) => ({
      title: li.title || '',
      quantity: li.quantity ?? 1,
      sku: li.sku ?? null,
      variantTitle: li.variantTitle ?? null,
    })),
    tracking: (order.fulfillments ?? []).flatMap((f) =>
      (f.trackingInfo ?? []).map((t) => ({
        number: t.number ?? null,
        url: t.url ?? null,
        company: t.company ?? null,
        status: f.status ?? null,
      })),
    ),
  }
}

interface CustomerNode {
  phone?: string | null
  defaultAddress?: { phone?: string | null } | null
  orders?: { nodes?: OrderNode[] | null } | null
}

interface OrderNode {
  id?: string
  name?: string
  displayFinancialStatus?: string | null
  displayFulfillmentStatus?: string | null
  createdAt?: string | null
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } | null } | null
  customer?: { phone?: string | null } | null
  shippingAddress?: { phone?: string | null } | null
  billingAddress?: { phone?: string | null } | null
  lineItems?: {
    nodes?: {
      title?: string | null
      quantity?: number | null
      sku?: string | null
      variantTitle?: string | null
    }[] | null
  } | null
  fulfillments?: {
    status?: string | null
    trackingInfo?: { number?: string | null; url?: string | null; company?: string | null }[] | null
  }[] | null
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}
