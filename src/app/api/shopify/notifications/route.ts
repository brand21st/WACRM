import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse, type AccountContext } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  canEnableShopifyTemplate,
  SHOPIFY_TEMPLATE_PICKER_STATUSES,
} from '@/lib/shopify/notification-templates'
import {
  isShopifyNotificationTrigger,
  mergeRules,
  SHOPIFY_NOTIFICATION_TRIGGERS,
  type ShopifyNotificationRule,
  type ShopifyVariableMap,
} from '@/lib/shopify/notification-triggers'

function isMissingRulesTable(error: { code?: string; message?: string } | null) {
  if (!error) return false
  return (
    error.code === 'PGRST205' ||
    /shopify_notification_rules/i.test(error.message ?? '')
  )
}

function asMap(value: unknown): ShopifyVariableMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ShopifyVariableMap = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string' && val.trim()) out[key] = val.trim()
  }
  return out
}

function asConfig(value: unknown): ShopifyNotificationRule['config'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const row = value as Record<string, unknown>
  const config: ShopifyNotificationRule['config'] = {}
  const delay = Number(row.delay_hours)
  if (Number.isFinite(delay)) {
    config.delay_hours = Math.min(168, Math.max(1, Math.floor(delay)))
  }
  const days = Number(row.days_after)
  if (Number.isFinite(days)) {
    config.days_after = Math.min(90, Math.max(1, Math.floor(days)))
  }
  if (typeof row.discount_code === 'string') {
    config.discount_code = row.discount_code.trim().slice(0, 40)
  }
  return config
}

async function loadPickerTemplates(
  supabase: AccountContext['supabase'],
  accountId: string,
) {
  const { data: templates } = await supabase
    .from('message_templates')
    .select('id, name, language, category, body_text, status')
    .eq('account_id', accountId)
    .in('status', [...SHOPIFY_TEMPLATE_PICKER_STATUSES])
    .neq('category', 'Authentication')
    .order('name')
  return templates ?? []
}

function parseRule(raw: unknown): ShopifyNotificationRule | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const trigger = String(row.trigger_key ?? '')
  if (!isShopifyNotificationTrigger(trigger)) return null
  const isEnabled = Boolean(row.is_enabled)
  const templateName =
    typeof row.template_name === 'string' && row.template_name.trim()
      ? row.template_name.trim()
      : null
  if (isEnabled && !templateName) return null
  return {
    trigger_key: trigger,
    is_enabled: isEnabled,
    template_name: templateName,
    template_language:
      typeof row.template_language === 'string' && row.template_language.trim()
        ? row.template_language.trim()
        : 'en_US',
    variable_map: asMap(row.variable_map),
    config: asConfig(row.config),
  }
}

/**
 * GET /api/shopify/notifications  (admin+)
 * PUT /api/shopify/notifications  (admin+)
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { data, error } = await supabase
      .from('shopify_notification_rules')
      .select(
        'trigger_key, is_enabled, template_name, template_language, variable_map, config',
      )
      .eq('account_id', accountId)

    const templates = await loadPickerTemplates(supabase, accountId)

    if (error) {
      if (isMissingRulesTable(error)) {
        return NextResponse.json({
          rules: mergeRules([]),
          templates,
          warning:
            'Run migration 048 (shopify_notification_rules) so order templates can be saved.',
        })
      }
      console.error('[shopify/notifications GET]', error)
      return NextResponse.json({ error: 'Failed to load notification rules' }, { status: 500 })
    }

    return NextResponse.json({
      rules: mergeRules((data ?? []) as Partial<ShopifyNotificationRule>[]),
      templates,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `shopify-notifications:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawRules = body && Array.isArray(body.rules) ? body.rules : null
    if (!rawRules) {
      return NextResponse.json({ error: 'rules array is required' }, { status: 400 })
    }

    const parsed: ShopifyNotificationRule[] = []
    for (const raw of rawRules) {
      const rule = parseRule(raw)
      if (!rule) {
        return NextResponse.json(
          { error: 'Each enabled trigger needs an approved WhatsApp template.' },
          { status: 400 },
        )
      }
      parsed.push(rule)
    }

    const seen = new Set<string>()
    for (const rule of parsed) {
      if (seen.has(rule.trigger_key)) {
        return NextResponse.json({ error: 'Duplicate trigger' }, { status: 400 })
      }
      seen.add(rule.trigger_key)
    }

    const enabledRules = parsed.filter((rule) => rule.is_enabled && rule.template_name)
    if (enabledRules.length > 0) {
      const templates = await loadPickerTemplates(supabase, accountId)
      for (const rule of enabledRules) {
        const match = templates.find(
          (row) =>
            row.name === rule.template_name &&
            row.language === rule.template_language,
        )
        if (!canEnableShopifyTemplate(match?.status as string | undefined)) {
          return NextResponse.json(
            {
              error:
                'Each enabled trigger needs an approved WhatsApp template. Wait for Meta approval or pick another template.',
            },
            { status: 400 },
          )
        }
      }
    }

    const rows = SHOPIFY_NOTIFICATION_TRIGGERS.map((key) => {
      const rule = parsed.find((r) => r.trigger_key === key) ?? {
        trigger_key: key,
        is_enabled: false,
        template_name: null,
        template_language: 'en_US',
        variable_map: {},
        config: {},
      }
      return {
        account_id: accountId,
        trigger_key: rule.trigger_key,
        is_enabled: rule.is_enabled,
        template_name: rule.template_name,
        template_language: rule.template_language,
        variable_map: rule.variable_map,
        config: rule.config,
      }
    })

    const { error } = await supabase
      .from('shopify_notification_rules')
      .upsert(rows, { onConflict: 'account_id,trigger_key' })

    if (error) {
      if (isMissingRulesTable(error)) {
        return NextResponse.json(
          {
            error:
              'Run migration 048 (shopify_notification_rules) before saving order templates.',
          },
          { status: 400 },
        )
      }
      console.error('[shopify/notifications PUT]', error)
      return NextResponse.json({ error: 'Failed to save notification rules' }, { status: 500 })
    }

    return NextResponse.json({ success: true, rules: mergeRules(parsed) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
