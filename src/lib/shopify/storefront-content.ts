import { htmlToText, extractHtmlByClass } from './html-to-text'
import { storefrontOrigin } from './domain'
import type { ShopifyStoreConfig } from './types'

const BODY_MAX = 20_000
const MIN_BODY = 40

const PUBLIC_POLICIES = [
  {
    type: 'PRIVACY_POLICY',
    handle: 'privacy-policy',
    title: 'Privacy Policy',
    path: '/policies/privacy-policy',
  },
  {
    type: 'REFUND_POLICY',
    handle: 'refund-policy',
    title: 'Refund Policy',
    path: '/policies/refund-policy',
  },
  {
    type: 'SHIPPING_POLICY',
    handle: 'shipping-policy',
    title: 'Shipping Policy',
    path: '/policies/shipping-policy',
  },
  {
    type: 'TERMS_OF_SERVICE',
    handle: 'terms-of-service',
    title: 'Terms of Service',
    path: '/policies/terms-of-service',
  },
  {
    type: 'SUBSCRIPTION_POLICY',
    handle: 'subscription-policy',
    title: 'Subscription Policy',
    path: '/policies/subscription-policy',
  },
] as const

const PUBLIC_PAGE_HANDLES = [
  { handle: 'about', title: 'About' },
  { handle: 'about-us', title: 'About Us' },
  { handle: 'contact', title: 'Contact' },
  { handle: 'contact-us', title: 'Contact Us' },
  { handle: 'faq', title: 'FAQ' },
  { handle: 'faqs', title: 'FAQs' },
  { handle: 'shipping', title: 'Shipping' },
  { handle: 'returns', title: 'Returns' },
] as const

function originsFor(config: ShopifyStoreConfig): string[] {
  const out: string[] = []
  const primary = storefrontOrigin(config.primaryDomain)
  if (primary) out.push(primary)
  const myshop = `https://${config.shopDomain}`
  if (!out.includes(myshop)) out.push(myshop)
  return out
}

async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'waCRM-store-sync/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const html = await res.text()
    return html || null
  } catch {
    return null
  }
}

function policyBodyFromHtml(html: string): string {
  const inner =
    extractHtmlByClass(html, 'shopify-policy__body') ||
    extractHtmlByClass(html, 'rte') ||
    html
  return htmlToText(inner, BODY_MAX)
}

function pageBodyFromHtml(html: string): { title: string | null; body: string } {
  const inner =
    extractHtmlByClass(html, 'rte') ||
    extractHtmlByClass(html, 'shopify-section') ||
    html
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  return {
    title: h1 ? htmlToText(h1, 120) : null,
    body: htmlToText(inner, BODY_MAX),
  }
}

export async function fetchStorefrontPolicies(
  config: ShopifyStoreConfig,
  accountId: string,
  syncedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  for (const origin of originsFor(config)) {
    for (const policy of PUBLIC_POLICIES) {
      const url = `${origin}${policy.path}`
      const html = await fetchHtml(url, fetchImpl)
      if (!html) continue
      const body = policyBodyFromHtml(html)
      if (body.length < MIN_BODY) continue
      const already = rows.some(
        (r) => r.shopify_resource_id === `gid://shopify/ShopPolicy/${policy.type}`,
      )
      if (already) continue
      rows.push({
        account_id: accountId,
        shopify_resource_id: `gid://shopify/ShopPolicy/${policy.type}`,
        kind: 'policy',
        handle: policy.handle,
        title: policy.title,
        body,
        page_url: url,
        synced_at: syncedAt,
      })
    }
    if (rows.length > 0) break
  }
  return rows
}

export async function fetchStorefrontPages(
  config: ShopifyStoreConfig,
  accountId: string,
  syncedAt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = []
  const seen = new Set<string>()
  for (const origin of originsFor(config)) {
    for (const page of PUBLIC_PAGE_HANDLES) {
      if (seen.has(page.handle)) continue
      const url = `${origin}/pages/${page.handle}`
      const html = await fetchHtml(url, fetchImpl)
      if (!html) continue
      if (/page not found|404|couldn't find/i.test(html) && html.length < 8000) {
        continue
      }
      const parsed = pageBodyFromHtml(html)
      if (parsed.body.length < MIN_BODY) continue
      seen.add(page.handle)
      rows.push({
        account_id: accountId,
        shopify_resource_id: `gid://shopify/OnlineStorePage/${page.handle}`,
        kind: 'page',
        handle: page.handle,
        title: parsed.title || page.title,
        body: parsed.body,
        page_url: url,
        synced_at: syncedAt,
      })
    }
  }
  return rows
}
