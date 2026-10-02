import type { SupabaseClient } from '@supabase/supabase-js'

import { submitTemplateForAccount } from '@/lib/whatsapp/submit-template-for-account'
import {
  buildPresetSubmitPayload,
  canEnableShopifyTemplate,
  findPresetTemplate,
  isPresetNameForTrigger,
  isShopifyTemplateName,
  presetForTrigger,
  triggersMissingPresets,
  type ShopifyPickerTemplate,
} from '@/lib/shopify/notification-templates'
import {
  defaultRule,
  SHOPIFY_NOTIFICATION_TRIGGERS,
  type ShopifyNotificationRule,
  type ShopifyNotificationTrigger,
} from '@/lib/shopify/notification-triggers'

export interface InstallShopifyOrderTemplatesResult {
  skippedReason?: 'no_waba' | 'no_owner'
  submitted: string[]
  alreadyPresent: string[]
  enabled: ShopifyNotificationTrigger[]
  failed: Array<{ name: string; error: string }>
}

/**
 * Build the rule upsert for auto-install.
 * Existing merchant rows keep their maps/config/disabled state unless
 * this is a pending preset waiting on Meta (empty or preset name + off).
 */
export function nextInstallRule(
  trigger: ShopifyNotificationTrigger,
  existing: ShopifyNotificationRule | undefined,
  template: ShopifyPickerTemplate | undefined,
): ShopifyNotificationRule {
  const preset = presetForTrigger(trigger)
  const approved = canEnableShopifyTemplate(template?.status)
  const base = defaultRule(trigger)
  if (!existing) {
    return {
      ...base,
      template_name: preset.name,
      template_language: preset.language,
      is_enabled: approved,
    }
  }

  const usesPreset =
    !existing.template_name ||
    isPresetNameForTrigger(existing.template_name, trigger)
  const enablePending = usesPreset && !existing.is_enabled && approved

  return {
    ...existing,
    trigger_key: trigger,
    template_name: existing.template_name || preset.name,
    template_language: existing.template_language || preset.language,
    variable_map:
      existing.variable_map && Object.keys(existing.variable_map).length > 0
        ? existing.variable_map
        : base.variable_map,
    config: { ...base.config, ...existing.config },
    is_enabled: enablePending ? true : existing.is_enabled,
  }
}

export function shouldEnablePendingPresetRule(
  rule: Pick<ShopifyNotificationRule, 'is_enabled' | 'template_name' | 'trigger_key'>,
  templateName: string,
): boolean {
  if (rule.is_enabled) return false
  if (rule.template_name !== templateName) return false
  if (!isShopifyTemplateName(templateName)) return false
  return isPresetNameForTrigger(templateName, rule.trigger_key)
}

async function resolveOwnerUserId(
  supabase: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle()
  if (error || !data?.owner_user_id) return null
  return String(data.owner_user_id)
}

async function loadPickerTemplates(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ShopifyPickerTemplate[]> {
  const { data } = await supabase
    .from('message_templates')
    .select('id, name, language, category, body_text, status')
    .eq('account_id', accountId)
    .like('name', 'shopify_%')
  return (data ?? []) as ShopifyPickerTemplate[]
}

async function loadRules(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ShopifyNotificationRule[]> {
  const { data } = await supabase
    .from('shopify_notification_rules')
    .select(
      'trigger_key, is_enabled, template_name, template_language, variable_map, config',
    )
    .eq('account_id', accountId)
  return (data ?? []) as ShopifyNotificationRule[]
}

export async function enableShopifyRulesForApprovedTemplate(
  supabase: SupabaseClient,
  args: { accountId: string; templateName: string },
): Promise<void> {
  if (!isShopifyTemplateName(args.templateName)) return
  const { error } = await supabase
    .from('shopify_notification_rules')
    .update({ is_enabled: true })
    .eq('account_id', args.accountId)
    .eq('template_name', args.templateName)
    .eq('is_enabled', false)
  if (error) {
    console.warn(
      '[shopify/templates] enable rules after APPROVED failed:',
      error.message,
    )
  }
}

export async function installShopifyOrderTemplates(
  supabase: SupabaseClient,
  args: { accountId: string; ownerUserId?: string },
): Promise<InstallShopifyOrderTemplatesResult> {
  const result: InstallShopifyOrderTemplatesResult = {
    submitted: [],
    alreadyPresent: [],
    enabled: [],
    failed: [],
  }

  const { data: wa } = await supabase
    .from('whatsapp_config')
    .select('waba_id')
    .eq('account_id', args.accountId)
    .maybeSingle()
  const wabaId = typeof wa?.waba_id === 'string' ? wa.waba_id.trim() : ''
  if (!wabaId) {
    result.skippedReason = 'no_waba'
    return result
  }

  const ownerUserId =
    args.ownerUserId ?? (await resolveOwnerUserId(supabase, args.accountId))
  if (!ownerUserId) {
    result.skippedReason = 'no_owner'
    return result
  }

  let templates = await loadPickerTemplates(supabase, args.accountId)
  const missing = triggersMissingPresets(templates)
  for (const trigger of SHOPIFY_NOTIFICATION_TRIGGERS) {
    if (!missing.includes(trigger)) {
      result.alreadyPresent.push(presetForTrigger(trigger).name)
    }
  }

  for (const trigger of missing) {
    const preset = presetForTrigger(trigger)
    const payload = buildPresetSubmitPayload(preset, preset.body_text, '')
    const submitted = await submitTemplateForAccount(supabase, {
      accountId: args.accountId,
      userId: ownerUserId,
      payload,
    })
    if (!submitted.ok) {
      result.failed.push({ name: preset.name, error: submitted.error })
      continue
    }
    result.submitted.push(preset.name)
    const status =
      typeof submitted.template.status === 'string'
        ? submitted.template.status
        : 'PENDING'
    templates = templates.filter((row) => row.name !== preset.name)
    templates.push({
      name: preset.name,
      language: preset.language,
      status,
      category: preset.category,
      body_text: preset.body_text,
    })
  }

  const existingRules = await loadRules(supabase, args.accountId)
  const byKey = new Map(
    existingRules.map((row) => [row.trigger_key, row] as const),
  )
  const rows = SHOPIFY_NOTIFICATION_TRIGGERS.map((trigger) => {
    const template = findPresetTemplate(templates, trigger)
    const next = nextInstallRule(trigger, byKey.get(trigger), template)
    if (next.is_enabled) result.enabled.push(trigger)
    return {
      account_id: args.accountId,
      trigger_key: next.trigger_key,
      is_enabled: next.is_enabled,
      template_name: next.template_name,
      template_language: next.template_language,
      variable_map: next.variable_map,
      config: next.config,
    }
  })

  const { error: upsertError } = await supabase
    .from('shopify_notification_rules')
    .upsert(rows, { onConflict: 'account_id,trigger_key' })
  if (upsertError) {
    console.warn(
      '[shopify/templates] rule upsert failed:',
      upsertError.message,
    )
  }

  return result
}

/** Fire-and-forget wrapper for connect/bootstrap — never throws. */
export async function scheduleInstallShopifyOrderTemplates(
  supabase: SupabaseClient,
  accountId: string,
): Promise<void> {
  try {
    const result = await installShopifyOrderTemplates(supabase, { accountId })
    if (result.failed.length > 0) {
      console.error('[shopify/templates] install failures:', result.failed)
    }
  } catch (err) {
    console.error('[shopify/templates] install failed:', err)
  }
}
