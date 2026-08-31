import { shopifyRest } from './client'
import { SHOPIFY_WEBHOOK_TOPICS } from './webhook-topics'
import type { ShopifyStoreConfig } from './types'

interface WebhookRow {
  id?: number
  topic?: string
  address?: string
}

function webhookCallbackUrl(): string | null {
  const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (!origin) return null
  return `${origin}/api/shopify/webhook`
}

/**
 * Ensure Shopify sends catalog, page, and order-notification events to waCRM.
 * Optional topics (e.g. returns/request) are skipped when the shop plan
 * rejects them; other topics still register.
 */
export async function registerCatalogWebhooks(
  config: ShopifyStoreConfig,
): Promise<{ registered: string[]; skipped: string[] }> {
  const address = webhookCallbackUrl()
  if (!address) {
    console.warn(
      '[shopify/webhooks] NEXT_PUBLIC_SITE_URL is unset — cannot register catalog webhooks',
    )
    return { registered: [], skipped: [...SHOPIFY_WEBHOOK_TOPICS] }
  }

  const list = await shopifyRest<{ webhooks?: WebhookRow[] }>({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    path: '/webhooks.json',
  })

  const existing = new Set(
    (list.webhooks ?? [])
      .filter((w) => w.address === address && w.topic)
      .map((w) => w.topic as string),
  )

  const registered: string[] = []
  const skipped: string[] = []

  for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
    if (existing.has(topic)) {
      skipped.push(topic)
      continue
    }
    try {
      await shopifyRest({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        path: '/webhooks.json',
        method: 'POST',
        body: {
          webhook: {
            topic,
            address,
            format: 'json',
          },
        },
      })
      registered.push(topic)
    } catch (err) {
      console.error(`[shopify/webhooks] failed to register ${topic}:`, err)
      skipped.push(topic)
    }
  }

  return { registered, skipped }
}
