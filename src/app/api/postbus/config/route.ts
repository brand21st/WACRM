import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  POSTBUS_CONFIG_COLUMNS,
  derivePostBusStatus,
  emptyPublicConfig,
  isGlobalPostBusMode,
  isMaskedApiKey,
  parseNotificationSettings,
  parsePostBusRoutingMode,
  toPublicConfig,
  type PostBusIntegrationRow,
} from '@/lib/postbus/config'
import {
  POSTBUS_LIVE_EVENTS,
  POSTBUS_TEMPLATE_COLUMNS,
} from '@/lib/postbus/events'
import {
  accountHasSendApiKey,
  accountHasWhatsAppConfig,
  listApprovedTemplates,
} from '@/lib/postbus/readiness'
import { parsePostBusApiBaseUrl } from '@/lib/postbus/url'
import { encrypt } from '@/lib/whatsapp/encryption'
import {
  generateWebhookSecret,
  normalizeWebhookUrl,
} from '@/lib/webhooks/endpoints'
import { isDeliverableUrl } from '@/lib/webhooks/ssrf'

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function extras(
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase'],
  accountId: string,
  row: PostBusIntegrationRow | null,
) {
  const [whatsappConfigured, hasSendApiKey, approvedTemplates] =
    await Promise.all([
      accountHasWhatsAppConfig(supabase, accountId),
      accountHasSendApiKey(supabase, accountId),
      listApprovedTemplates(supabase, accountId),
    ])

  let statusWebhookUrl: string | null = null
  if (row?.webhook_endpoint_id) {
    const { data } = await supabase
      .from('webhook_endpoints')
      .select('url')
      .eq('id', row.webhook_endpoint_id)
      .eq('account_id', accountId)
      .maybeSingle()
    statusWebhookUrl = (data?.url as string | undefined) ?? null
  }

  return {
    whatsappConfigured,
    hasSendApiKey,
    approvedTemplates,
    statusWebhookUrl,
  }
}

/**
 * GET /api/postbus/config
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[postbus/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load PostBus connection' },
        { status: 500 },
      )
    }

    if (!data) {
      const none = emptyPublicConfig(accountId)
      try {
        const extra = await extras(supabase, accountId, null)
        none.whatsapp_connected = extra.whatsappConfigured
        none.has_send_api_key = extra.hasSendApiKey
        none.approved_templates = extra.approvedTemplates
        none.detailLabel = `${extra.whatsappConfigured ? 'WhatsApp connected' : 'WhatsApp not connected'} · 0 notifications enabled`
      } catch (extraErr) {
        console.error('[postbus/config GET] extras:', extraErr)
      }
      return NextResponse.json(none)
    }

    const row = data as unknown as PostBusIntegrationRow
    const extra = await extras(supabase, accountId, row)
    return NextResponse.json(
      toPublicConfig(row, {
        whatsappConfigured: extra.whatsappConfigured,
        hasSendApiKey: extra.hasSendApiKey,
        approvedTemplates: extra.approvedTemplates,
        statusWebhookUrl: extra.statusWebhookUrl,
      }),
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}

async function upsertStatusWebhook(args: {
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase']
  accountId: string
  userId: string
  existingEndpointId: string | null
  rawUrl: unknown
}): Promise<string | null> {
  if (args.rawUrl == null) return args.existingEndpointId
  if (typeof args.rawUrl !== 'string') {
    throw new Error('status_webhook_url must be a string')
  }
  const trimmed = args.rawUrl.trim()
  if (!trimmed) {
    if (args.existingEndpointId) {
      await args.supabase
        .from('webhook_endpoints')
        .delete()
        .eq('id', args.existingEndpointId)
        .eq('account_id', args.accountId)
    }
    return null
  }
  const url = normalizeWebhookUrl(trimmed)
  if (!url) {
    throw new Error('status_webhook_url must be a valid https:// URL')
  }
  if (!(await isDeliverableUrl(url))) {
    throw new Error('status_webhook_url must be a public HTTPS URL')
  }
  if (args.existingEndpointId) {
    const { error } = await args.supabase
      .from('webhook_endpoints')
      .update({ url, events: ['message.status_updated'], is_active: true })
      .eq('id', args.existingEndpointId)
      .eq('account_id', args.accountId)
    if (error) throw error
    return args.existingEndpointId
  }
  const secret = generateWebhookSecret()
  const { data, error } = await args.supabase
    .from('webhook_endpoints')
    .insert({
      account_id: args.accountId,
      created_by: args.userId,
      url,
      secret: encrypt(secret),
      events: ['message.status_updated'],
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('Failed to register webhook')
  return data.id as string
}

/**
 * PUT /api/postbus/config  (admin+)
 */
export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`postbus-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body !== 'object') {
      return bad('Request body must be a JSON object')
    }

    const merchantRaw =
      typeof body.postbus_merchant_id === 'string'
        ? body.postbus_merchant_id.trim()
        : body.postbus_merchant_id == null
          ? ''
          : null
    if (merchantRaw === null) {
      return bad('postbus_merchant_id must be a string')
    }

    const urlParsed = parsePostBusApiBaseUrl(body.api_base_url)
    if (!urlParsed.ok) return bad(urlParsed.error)

    const incomingKey =
      typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const keyEdited = incomingKey.length > 0 && !isMaskedApiKey(incomingKey)

    const { data: existing, error: existingErr } = await supabase
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()

    if (existingErr) {
      console.error('[postbus/config PUT] fetch error:', existingErr)
      return NextResponse.json(
        { error: 'Failed to load PostBus connection' },
        { status: 500 },
      )
    }

    const existingRow = existing as unknown as PostBusIntegrationRow | null
    if (isGlobalPostBusMode(existingRow)) {
      return NextResponse.json(
        {
          error:
            'This account is the platform PostBus sender. Super Admin manages templates and routing.',
        },
        { status: 403 },
      )
    }
    let apiKeyEncrypted = existingRow?.api_key_encrypted ?? null
    if (keyEdited) {
      apiKeyEncrypted = encrypt(incomingKey)
    }

    const notificationSettings = parseNotificationSettings(
      body.notification_settings ?? existingRow?.notification_settings,
    )

    const merchantId = merchantRaw.length > 0 ? merchantRaw : null
    const apiBaseUrl = urlParsed.url.length > 0 ? urlParsed.url : null
    const routingMode = parsePostBusRoutingMode(existingRow?.routing_mode)

    const templateLanguage =
      typeof body.template_language === 'string' && body.template_language.trim()
        ? body.template_language.trim()
        : existingRow?.template_language || 'en_US'

    const templates: Record<string, string | null> = {}
    for (const event of POSTBUS_LIVE_EVENTS) {
      const col = POSTBUS_TEMPLATE_COLUMNS[event]
      if (typeof body[col] === 'string') {
        templates[col] = body[col].trim() || null
      } else if (body[col] == null && col in body) {
        templates[col] = null
      } else {
        templates[col] = (existingRow?.[col] as string | null | undefined) ?? null
      }
    }

    let webhookEndpointId = existingRow?.webhook_endpoint_id ?? null
    if ('status_webhook_url' in body) {
      try {
        webhookEndpointId = await upsertStatusWebhook({
          supabase,
          accountId,
          userId,
          existingEndpointId: webhookEndpointId,
          rawUrl: body.status_webhook_url,
        })
      } catch (err) {
        return bad(err instanceof Error ? err.message : 'Invalid webhook URL')
      }
    }

    const whatsappConfigured = await accountHasWhatsAppConfig(supabase, accountId)
    const status = derivePostBusStatus({
      postbusMerchantId: merchantId,
      whatsappConfigured,
      routingMode,
    })
    const connectedAt =
      status === 'connected'
        ? (existingRow?.connected_at ?? new Date().toISOString())
        : existingRow?.connected_at ?? null

    const payload = {
      postbus_merchant_id: merchantId,
      routing_mode: routingMode,
      api_base_url: apiBaseUrl,
      api_key_encrypted: apiKeyEncrypted,
      status,
      notification_settings: notificationSettings,
      connected_at: connectedAt,
      template_language: templateLanguage,
      webhook_endpoint_id: webhookEndpointId,
      ...templates,
    }

    const query = existingRow
      ? supabase
          .from('postbus_integrations')
          .update(payload)
          .eq('account_id', accountId)
          .select(POSTBUS_CONFIG_COLUMNS)
          .single()
      : supabase
          .from('postbus_integrations')
          .insert({
            account_id: accountId,
            created_by: userId,
            ...payload,
          })
          .select(POSTBUS_CONFIG_COLUMNS)
          .single()

    const { data: saved, error: saveErr } = await query

    if (saveErr) {
      if (isUniqueViolation(saveErr)) {
        return bad(
          'This PostBus merchant ID is already connected to another Vachat account.',
          409,
        )
      }
      console.error('[postbus/config PUT] save error:', saveErr)
      return NextResponse.json(
        { error: 'Failed to save PostBus connection' },
        { status: 500 },
      )
    }

    const extra = await extras(
      supabase,
      accountId,
      saved as unknown as PostBusIntegrationRow,
    )
    return NextResponse.json(
      toPublicConfig(saved as unknown as PostBusIntegrationRow, extra),
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/postbus/config  (admin+)
 */
export async function DELETE() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `postbus-disconnect:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const { error } = await supabase
      .from('postbus_integrations')
      .delete()
      .eq('account_id', accountId)

    if (error) {
      console.error('[postbus/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect PostBus' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
