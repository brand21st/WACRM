import type { SupabaseClient } from '@supabase/supabase-js'
import { shopifyGraphql } from './client'
import { CUSTOMERS_BY_QUERY, ORDERS_BY_QUERY } from './queries'
import {
  getProductLive,
  listBestSelling,
  listNewArrivals,
  searchProducts,
  searchShoppingCatalog,
} from './catalog'
import {
  listRecommendedProducts,
  parseRecommendRole,
  type CustomerProductInterest,
} from './recommend'
import {
  DEFAULT_SEARCH_CARDS,
  resolveProductCardLimit,
} from '@/lib/ai/product-card-limit'
import {
  matchProductsToAsk,
  parseBudget,
  parsePriceArg,
  productAskTokens,
  productSearchQuery,
} from './rank'
import {
  matchProductsFromPhoto,
  type MatchProductsFromPhotoOpts,
} from './match-photo'
import { searchStoreContent } from './store-content'
import { customerSearchQueries, shopifyPhoneMatchesContact } from './phone'
import { retailerIdForProduct } from './retailer-id'
import type { RetailerIdSource } from './retailer-id'
import { orderCardsFromHits } from '@/lib/ai/order-card'
import type {
  ShopifyOrderCard,
  ShopifyOrderHit,
  ShopifyProductCard,
  ShopifyProductHit,
  ShopifyStoreConfig,
  ShopifyVariantHit,
} from './types'
import type { LlmToolDef } from '@/lib/ai/providers/shared'
import {
  buildCartOffer,
  resolveCartOfferItems,
  type CartOffer,
} from './cart-offer'

export const SHOPIFY_LLM_TOOLS: LlmToolDef[] = [
  {
    name: 'search_products',
    description:
      'Search the Shopify catalog for what the customer asked: product, category, color, occasion, related, or keywords. Set max_price when they gave a budget. Returns every catalog-matched product, plus close alternatives only when nothing exact matches. Never invent products.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search text copied from what they asked, e.g. "black shirt" or a SKU',
        },
        max_price: {
          type: 'number',
          description: 'Maximum price when they stated a budget, e.g. 1500',
        },
        min_price: {
          type: 'number',
          description: 'Minimum price when they stated a range',
        },
        limit: {
          type: 'integer',
          description:
            'How many cards to send (1–50). Omit to send every catalog match. Set only when they asked for a specific count.',
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
    description:
      'List the newest published products. Use for new products, new arrivals, or the wacrm:products button. Do not use search_products for those browse phrases.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description:
            'How many to return (1–50). Omit to send every catalog match.',
        },
      },
    },
  },
  {
    name: 'list_best_selling',
    description:
      'List best-selling or trending Shopify products. Use when the customer asks for best selling, bestsellers, popular, or trending products. Do not use search_products for those browse phrases.',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description:
            'How many to return (1–50). Omit to send every catalog match.',
        },
      },
    },
  },
  {
    name: 'recommend_products',
    description:
      'Recommend related or matching Shopify catalog products. role=recommend for “for me”, related, or similar picks — send every catalog match. role=upsell for one genuine higher-value version of the shown product. role=cross_sell for 1 complementary add-on. Do not use for a named product search. Never invent discounts.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional extra hint from this message, e.g. "wedding" or a color',
        },
        role: {
          type: 'string',
          enum: ['recommend', 'upsell', 'cross_sell'],
          description: 'recommend (default), upsell, or cross_sell',
        },
        limit: {
          type: 'integer',
          description:
            'How many to return (1–50). Omit to send every catalog match.',
        },
      },
    },
  },
  {
    name: 'match_product_from_photo',
    description:
      'Match a customer product photo against the Shopify catalog. Uses a vision description to search, then confirms the same product against listing photos. Returns 0–2 exact matches — never invent products.',
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
      'Look up this WhatsApp customer’s Shopify orders. Always uses the contact phone; never other customers. Optional order name like #1001. An order card with a Track order button is sent separately — do not paste tracking URLs.',
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
      'Get shipment tracking for this WhatsApp customer’s order (phone-gated). An order card with a Track order button is sent separately — do not paste tracking URLs.',
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
  {
    name: 'offer_cart',
    description:
      'Build a cart link and checkout link from products already shown in this chat. Call when the customer asks for their cart, a checkout link, “send me the link”, or is ready to buy. Recap what they asked in the spoken reply — do not paste cart or checkout URLs. If nothing has been shown yet, search the catalog first.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
]

export const SEND_WHATSAPP_CATALOG_TOOL: LlmToolDef = {
  name: 'send_whatsapp_catalog',
  description:
    'Send the full WhatsApp commerce catalog (View catalog). Call only when the customer asks for the catalog, catalogue, or to browse the store catalog. Do not call for named products, new arrivals, or photo match.',
  parameters: {
    type: 'object',
    properties: {},
  },
}

const FOCUSED_PRODUCT_TOOLS = new Set([
  'get_product',
  'search_store_info',
  'lookup_my_orders',
  'get_order_tracking',
])

export function shopifyLlmTools(opts?: {
  whatsappCatalog?: boolean
  focused?: boolean
}): LlmToolDef[] {
  const tools = opts?.whatsappCatalog
    ? [...SHOPIFY_LLM_TOOLS, SEND_WHATSAPP_CATALOG_TOOL]
    : [...SHOPIFY_LLM_TOOLS]
  if (opts?.focused) {
    return tools.filter((tool) => FOCUSED_PRODUCT_TOOLS.has(tool.name))
  }
  return tools
}

const CATALOG_BROWSE_TOOLS = new Set([
  'search_products',
  'list_new_arrivals',
  'list_best_selling',
  'recommend_products',
  'match_product_from_photo',
])

export interface ShopifyToolContext {
  db: SupabaseClient
  config: ShopifyStoreConfig
  contactPhone: string | null
  photoMatch?: MatchProductsFromPhotoOpts
  productCards?: ShopifyProductCard[]
  conversationId?: string | null
  nativeCommerce?: boolean
  retailerIdSource?: RetailerIdSource
  customerInterest?: CustomerProductInterest
  customerText?: string | null
  focusedHandle?: string | null
}

export interface ShopifyToolResult {
  json: string
  cards: ShopifyProductCard[]
  orderCards?: ShopifyOrderCard[]
  cartOffer?: CartOffer | null
  sendCatalog?: boolean
}

export async function executeShopifyTool(
  ctx: ShopifyToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<ShopifyToolResult> {
  try {
    const focusedHandle = ctx.focusedHandle?.trim() || ''
    if (focusedHandle && (CATALOG_BROWSE_TOOLS.has(name) || name === 'get_product')) {
      const requested = name === 'get_product' ? str(args.id).trim() : ''
      const id =
        requested && requested.toLowerCase() === focusedHandle.toLowerCase()
          ? requested
          : focusedHandle
      const hit = await getProductLive(ctx.config, id)
      const ok =
        Boolean(hit) &&
        hit!.handle.trim().toLowerCase() === focusedHandle.toLowerCase()
      return productsResult(ok && hit ? [hit] : [], ctx.retailerIdSource, 1)
    }
    switch (name) {
      case 'search_products': {
        const limit = resolveProductCardLimit(args.limit, ctx.customerText)
        const raw = str(args.query) || (ctx.customerText ?? '').trim()
        const query = productSearchQuery(raw) || raw
        const fromArgs = {
          min: parsePriceArg(args.min_price),
          max: parsePriceArg(args.max_price),
        }
        const parsed = parseBudget(ctx.customerText) ?? parseBudget(raw)
        const budget = {
          min: fromArgs.min ?? parsed?.min,
          max: fromArgs.max ?? parsed?.max,
        }
        const ranked = await searchShoppingCatalog(
          ctx.db,
          ctx.config,
          query,
          limit,
          { allowCloseAlternatives: true, budget },
        )
        if (ranked.hits.length > 0) {
          return productsResult(
            ranked.hits,
            ctx.retailerIdSource,
            limit,
            ranked.exact
              ? undefined
              : 'No exact match. These are the closest catalog options. Explain what changed. Do not invent items.',
          )
        }
        const relatedLimit = Math.min(limit, 10)
        const related = await listNewArrivals(ctx.db, ctx.config, relatedLimit)
        return productsResult(
          related,
          ctx.retailerIdSource,
          relatedLimit,
          related.length > 0
            ? 'No exact match. These are related catalog products. Say they are alternatives. Do not invent items.'
            : undefined,
        )
      }
      case 'get_product': {
        const hit = await getProductLive(ctx.config, str(args.id))
        return productsResult(hit ? [hit] : [], ctx.retailerIdSource, 1)
      }
      case 'list_new_arrivals': {
        const limit = resolveProductCardLimit(args.limit, ctx.customerText)
        return productsResult(
          await listNewArrivals(ctx.db, ctx.config, limit),
          ctx.retailerIdSource,
          limit,
        )
      }
      case 'list_best_selling': {
        const limit = resolveProductCardLimit(args.limit, ctx.customerText)
        return productsResult(
          await listBestSelling(ctx.db, ctx.config, limit),
          ctx.retailerIdSource,
          limit,
        )
      }
      case 'recommend_products': {
        const role = parseRecommendRole(args.role)
        const limit =
          role === 'upsell'
            ? 1
            : role === 'cross_sell'
              ? Math.min(2, resolveProductCardLimit(args.limit, ctx.customerText))
              : resolveProductCardLimit(args.limit, ctx.customerText)
        const query = str(args.query) || ctx.customerInterest?.query || ''
        const ask = (ctx.customerText ?? '').trim() || query
        let hits = await listRecommendedProducts(
          ctx.db,
          ctx.config,
          {
            ...(ctx.customerInterest ?? {}),
            query: query || ctx.customerInterest?.query,
          },
          { limit, shownCards: ctx.productCards, role },
        )
        if (role === 'recommend' && productAskTokens(ask).length > 0) {
          const matched = matchProductsToAsk(ask, hits, limit, {
            allowCloseAlternatives: true,
          })
          hits =
            matched.length > 0
              ? matched
              : await searchProducts(
                  ctx.db,
                  ctx.config,
                  productSearchQuery(ask) || query,
                  limit,
                  { allowCloseAlternatives: true },
                )
        }
        return productsResult(hits, ctx.retailerIdSource, limit)
      }
      case 'match_product_from_photo': {
        return productsResult(
          await matchProductsFromPhoto(
            ctx.db,
            ctx.config,
            str(args.description),
            ctx.photoMatch,
          ),
          ctx.retailerIdSource,
          DEFAULT_SEARCH_CARDS,
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
        return orderLookupResult(
          ctx,
          await lookupOrders(ctx, str(args.order_name) || undefined),
        )
      case 'get_order_tracking':
        return orderLookupResult(
          ctx,
          await lookupOrders(ctx, str(args.order_name) || undefined, true),
        )
      case 'offer_cart': {
        const items = await resolveCartOfferItems({
          db: ctx.db,
          conversationId: ctx.conversationId,
          cards: ctx.productCards ?? [],
        })
        if (ctx.nativeCommerce) {
          return {
            json: JSON.stringify({
              items: items.map((item) => ({
                title: item.title,
                quantity: item.quantity,
                price: item.price ?? null,
              })),
              native_checkout: true,
              note:
                'WhatsApp native checkout is on. Do not send cart or checkout URLs. If the customer opened the WhatsApp catalog, tell them to Add to cart there, then Send order. A Review and Pay bill is sent after they send the cart. Product cards in chat use Shopify Checkout NOW and are sent separately.',
            }),
            cards: [],
            cartOffer: null,
          }
        }
        const offer = buildCartOffer(ctx.config.primaryDomain, items)
        if (!offer) {
          return {
            json: JSON.stringify({
              items: [],
              note: 'No products have been shown yet. Search the catalog first, then offer the cart. Do not invent items or paste URLs.',
            }),
            cards: [],
            cartOffer: null,
          }
        }
        return {
          json: JSON.stringify({
            items: offer.items.map((item) => ({
              title: item.title,
              quantity: item.quantity,
              price: item.price ?? null,
            })),
            cart_url: offer.cartUrl,
            checkout_url: offer.checkoutUrl,
            summary_lines: offer.summaryLines,
          }),
          cards: [],
          cartOffer: offer,
        }
      }
      case 'send_whatsapp_catalog': {
        if (!ctx.config.metaCatalogId?.trim()) {
          return {
            json: JSON.stringify({
              sent: false,
              note: 'No WhatsApp catalog is configured. Search products instead and do not invent a catalog.',
            }),
            cards: [],
          }
        }
        return {
          json: JSON.stringify({
            sent: true,
            note: 'The WhatsApp commerce catalog will be sent separately. Do not search or list individual products on this turn. Tell the customer they can browse the catalog in chat.',
          }),
          cards: [],
          sendCatalog: true,
        }
      }
      default:
        return { json: JSON.stringify({ error: `Unknown tool: ${name}` }), cards: [] }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { json: JSON.stringify({ error: message }), cards: [] }
  }
}

function productsResult(
  hits: ShopifyProductHit[],
  source?: RetailerIdSource,
  maxCards = DEFAULT_SEARCH_CARDS,
  note?: string,
): ShopifyToolResult {
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
    json: JSON.stringify({
      products: hits.map(summarizeProduct),
      ...(note ? { note } : {}),
    }),
    cards: hits.slice(0, maxCards).map((hit) => toCard(hit, source)),
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
  const inStock = variants.filter((v) => v.available)
  const sizes = uniqueOptionValues(inStock, (v) => optionValue(v, /^size$/i))
  const colors = uniqueOptionValues(inStock, (v) =>
    optionValue(v, /^colou?r$/i),
  )
  const other =
    sizes.length === 0 && colors.length === 0
      ? uniqueOptionValues(inStock, otherVariantLabel)
      : []
  return [
    ...optionLine('Variants', sizes.length > 0 ? sizes : other),
    ...optionLine('Color', colors),
  ]
}

function salePriceLine(p: ShopifyProductHit): string {
  const sale =
    p.priceMin && p.priceMax && p.priceMin !== p.priceMax
      ? `${p.priceMin}–${p.priceMax}`
      : (p.priceMin ?? '')
  const currency = p.currency ? ` ${p.currency}` : ''
  if (!sale) return ''
  const compareAt = pickCompareAt(p)
  if (compareAt) return `~${compareAt}~ ${sale}${currency}`.trim()
  return `${sale}${currency}`.trim()
}

function pickCompareAt(p: ShopifyProductHit): string | null {
  const inStock = p.variants.filter((v) => v.available)
  const pool = inStock.length > 0 ? inStock : p.variants
  const onSale = pool.filter((v) => {
    const price = Number(v.price)
    const compare = Number(v.compareAtPrice)
    return Number.isFinite(price) && Number.isFinite(compare) && compare > price
  })
  if (onSale.length === 0) return null
  const cheapest = onSale.reduce((a, b) =>
    Number(a.price) <= Number(b.price) ? a : b,
  )
  return cheapest.compareAtPrice
}

export function toCard(
  p: ShopifyProductHit,
  source: RetailerIdSource = 'sku',
  selected?: ShopifyVariantHit | null,
): ShopifyProductCard {
  const variant = selected?.available ? selected : null
  const urls = variant ? urlsForVariant(p, variant.variantId) : null
  const price = variant ? variantPriceLine(variant, p.currency) : salePriceLine(p)
  const inStock = variant ? variant.available : productInStock(p)
  const lines = [
    p.title,
    price,
    inStock ? 'Stock in' : 'Stock out',
    ...(variant
      ? variantCaptionLines([variant])
      : variantCaptionLines(p.variants)),
    p.productUrl ? `View: ${p.productUrl}` : '',
  ].filter(Boolean)
  return {
    title: p.title,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    cartUrl: urls?.cartUrl ?? p.cartUrl,
    checkoutUrl: urls?.checkoutUrl ?? p.checkoutUrl,
    inStock,
    caption: lines.join('\n').slice(0, 1024),
    retailerId: retailerIdForProduct(p, source) || null,
    handle: p.handle || null,
    variantId: variant?.variantId ?? null,
  }
}

function urlsForVariant(
  p: ShopifyProductHit,
  variantId: string,
): { cartUrl: string | null; checkoutUrl: string | null } {
  const id = variantId.trim()
  if (!id) return { cartUrl: p.cartUrl, checkoutUrl: p.checkoutUrl }
  const cart = p.cartUrl
    ? p.cartUrl.replace(/\/cart\/[^/?#]+/, `/cart/${id}:1`)
    : null
  const checkout = cart
    ? cart.includes('?checkout')
      ? cart
      : `${cart}?checkout`
    : null
  return { cartUrl: cart, checkoutUrl: checkout }
}

function variantPriceLine(
  variant: ShopifyVariantHit,
  currency: string | null,
): string {
  if (!variant.price) return ''
  const suffix = currency ? ` ${currency}` : ''
  const compare = Number(variant.compareAtPrice)
  const price = Number(variant.price)
  if (Number.isFinite(compare) && Number.isFinite(price) && compare > price) {
    return `~${variant.compareAtPrice}~ ${variant.price}${suffix}`.trim()
  }
  return `${variant.price}${suffix}`.trim()
}

function orderLookupResult(
  ctx: ShopifyToolContext,
  result: { payload: Record<string, unknown>; hits: ShopifyOrderHit[] },
): ShopifyToolResult {
  return {
    json: JSON.stringify(result.payload),
    cards: [],
    orderCards: orderCardsFromHits(result.hits, ctx.contactPhone),
  }
}

async function lookupOrders(
  ctx: ShopifyToolContext,
  orderName?: string,
  trackingOnly = false,
): Promise<{ payload: Record<string, unknown>; hits: ShopifyOrderHit[] }> {
  if (!ctx.contactPhone) {
    return {
      payload: {
        orders: [],
        note: 'No WhatsApp phone on this contact, so orders cannot be looked up.',
      },
      hits: [],
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
      payload: {
        orders: [],
        note: 'No orders found for this WhatsApp number. Do not reveal anyone else’s orders.',
      },
      hits: [],
    }
  }

  return {
    payload: {
      orders: filtered.map((o) =>
        trackingOnly
          ? {
              name: o.name,
              fulfillment_status: o.fulfillmentStatus,
              tracking: o.tracking,
            }
          : o,
      ),
    },
    hits: filtered,
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
        out.push(
          mapOrder(
            order,
            {
              displayName: customer.displayName,
              phone: customer.phone ?? customer.defaultAddress?.phone,
            },
            ctx.contactPhone,
          ),
        )
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
      return mapOrder(
        order,
        {
          displayName: order.customer?.displayName,
          phone: order.customer?.phone,
        },
        ctx.contactPhone,
      )
    }
  }
  return null
}

function moneyFromSet(
  set?: { shopMoney?: { amount?: string; currencyCode?: string } | null } | null,
): { amount: string | null; currency: string | null } {
  return {
    amount: set?.shopMoney?.amount ?? null,
    currency: set?.shopMoney?.currencyCode ?? null,
  }
}

function mapOrder(
  order: OrderNode,
  customer?: { displayName?: string | null; phone?: string | null },
  contactPhone?: string | null,
): ShopifyOrderHit {
  const money = moneyFromSet(order.totalPriceSet)
  const customerName =
    customer?.displayName?.trim() || order.customer?.displayName?.trim() || null
  const customerPhone =
    customer?.phone?.trim() ||
    order.customer?.phone?.trim() ||
    contactPhone?.trim() ||
    null
  return {
    id: order.id || '',
    name: order.name || '',
    financialStatus: order.displayFinancialStatus ?? null,
    fulfillmentStatus: order.displayFulfillmentStatus ?? null,
    createdAt: order.createdAt ?? null,
    total: money.amount,
    currency: money.currency,
    customerName,
    customerPhone,
    statusPageUrl: order.statusPageUrl?.trim() || null,
    lineItems: (order.lineItems?.nodes ?? []).map((li) => {
      const priced =
        moneyFromSet(li.discountedTotalSet).amount
          ? moneyFromSet(li.discountedTotalSet)
          : moneyFromSet(li.originalTotalSet)
      return {
        title: li.title || '',
        quantity: li.quantity ?? 1,
        sku: li.sku ?? null,
        variantTitle: li.variantTitle ?? null,
        price: priced.amount,
        currency: priced.currency ?? money.currency,
      }
    }),
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
  displayName?: string | null
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
  statusPageUrl?: string | null
  totalPriceSet?: { shopMoney?: { amount?: string; currencyCode?: string } | null } | null
  customer?: { phone?: string | null; displayName?: string | null } | null
  shippingAddress?: { phone?: string | null } | null
  billingAddress?: { phone?: string | null } | null
  lineItems?: {
    nodes?: {
      title?: string | null
      quantity?: number | null
      sku?: string | null
      variantTitle?: string | null
      originalTotalSet?: {
        shopMoney?: { amount?: string; currencyCode?: string } | null
      } | null
      discountedTotalSet?: {
        shopMoney?: { amount?: string; currencyCode?: string } | null
      } | null
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
