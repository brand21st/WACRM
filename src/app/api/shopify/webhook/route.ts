import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { verifyShopifyWebhookHmac } from '@/lib/shopify/hmac'
import { handleShopifyProductWebhook } from '@/lib/shopify/catalog'
import { handleShopifyPageWebhook } from '@/lib/shopify/store-content'
import { handleShopifyNotificationWebhook } from '@/lib/shopify/notifications'
import { isShopifyNotificationTopic } from '@/lib/shopify/webhook-topics'
import { unpackShopifyCredential } from '@/lib/shopify/credential-storage'
import { normalizeShopDomain } from '@/lib/shopify/domain'
import { decrypt } from '@/lib/whatsapp/encryption'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * POST /api/shopify/webhook
 *
 * Receives Shopify app webhooks. HMAC is verified with the Partner API
 * secret (shpss_) stored for the shop. Product and page topics keep the
 * local snapshots in sync. Order/checkout/fulfillment topics send the
 * configured WhatsApp templates.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const shopHeader = request.headers.get('x-shopify-shop-domain') ?? ''
  const shopDomain = normalizeShopDomain(shopHeader)
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256')
  const topic = request.headers.get('x-shopify-topic') ?? 'unknown'

  if (!shopDomain) {
    return NextResponse.json({ error: 'Missing shop domain' }, { status: 400 })
  }

  const supabase = supabaseAdmin()
  const { data: row, error } = await supabase
    .from('shopify_configs')
    .select('account_id, access_token, client_id')
    .eq('shop_domain', shopDomain)
    .maybeSingle()

  if (error || !row?.access_token) {
    return NextResponse.json({ error: 'Shop not connected' }, { status: 404 })
  }

  let secret: string | null = null
  try {
    const unpacked = unpackShopifyCredential(decrypt(row.access_token))
    secret = unpacked.webhookSecret
  } catch {
    return NextResponse.json({ error: 'Invalid stored credentials' }, { status: 500 })
  }

  if (!secret) {
    return NextResponse.json(
      {
        error:
          'Webhook verification requires Partner API secret (shpss_). Save Client ID + secret in Settings, or reinstall the app.',
      },
      { status: 400 },
    )
  }

  if (!verifyShopifyWebhookHmac(rawBody, hmacHeader, secret)) {
    return NextResponse.json({ error: 'Invalid HMAC' }, { status: 401 })
  }

  let body: Record<string, unknown> = {}
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      }
    } catch {
      body = {}
    }
  }

  if (
    topic === 'products/create' ||
    topic === 'products/update' ||
    topic === 'products/delete'
  ) {
    try {
      await handleShopifyProductWebhook(supabase, row.account_id, topic, body)
    } catch (err) {
      console.error(`[shopify/webhook] ${topic} catalog sync failed:`, err)
      return NextResponse.json({ error: 'Catalog sync failed' }, { status: 500 })
    }
  } else if (
    topic === 'pages/create' ||
    topic === 'pages/update' ||
    topic === 'pages/delete'
  ) {
    try {
      await handleShopifyPageWebhook(supabase, row.account_id, topic, body)
    } catch (err) {
      console.error(`[shopify/webhook] ${topic} page sync failed:`, err)
      return NextResponse.json({ error: 'Page sync failed' }, { status: 500 })
    }
  } else if (isShopifyNotificationTopic(topic)) {
    try {
      await handleShopifyNotificationWebhook(
        supabase,
        row.account_id,
        topic,
        body,
      )
    } catch (err) {
      console.error(`[shopify/webhook] ${topic} notification failed:`, err)
      return NextResponse.json({ error: 'Notification failed' }, { status: 500 })
    }
  } else {
    console.info(
      `[shopify/webhook] ${topic} for ${shopDomain} (account ${row.account_id})`,
    )
  }

  return NextResponse.json({ ok: true })
}
