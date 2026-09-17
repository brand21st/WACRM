import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  MessageTemplate,
  TemplateButton,
  TemplateSampleValues,
} from '@/types'
import type { ShopifyNotificationRule } from '@/lib/shopify/notification-triggers'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'
import { isShopifyTemplateName } from '@/lib/shopify/notification-templates'

export interface OwnerAccount {
  accountId: string
  ownerUserId: string
  email: string
  name: string
}

export interface ShopifyTemplateRow {
  id: string
  account_id: string
  user_id: string
  name: string
  category: MessageTemplate['category']
  language: string
  header_type?: MessageTemplate['header_type'] | null
  header_content?: string | null
  header_media_url?: string | null
  header_handle?: string | null
  body_text: string
  footer_text?: string | null
  buttons?: TemplateButton[] | null
  sample_values?: TemplateSampleValues | null
  status?: string | null
}

export interface ShopifyRuleRow {
  trigger_key: ShopifyNotificationRule['trigger_key']
  is_enabled: boolean
  template_name: string | null
  template_language: string
  variable_map: ShopifyNotificationRule['variable_map']
  config: ShopifyNotificationRule['config']
}

const TEMPLATE_COLUMNS =
  'id, account_id, user_id, name, category, language, header_type, header_content, header_media_url, header_handle, body_text, footer_text, buttons, sample_values, status'

const RULE_COLUMNS =
  'trigger_key, is_enabled, template_name, template_language, variable_map, config'

export async function resolveAccountByOwnerEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<OwnerAccount> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) throw new Error('Email is required.')

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('user_id, email, full_name, account_id')
    .ilike('email', normalized)

  if (profileError) {
    throw new Error(`Failed to look up ${normalized}: ${profileError.message}`)
  }
  const matches = profiles ?? []
  if (matches.length === 0) {
    throw new Error(`No profile found for ${normalized}`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple profiles found for ${normalized}`)
  }
  const profile = matches[0]

  const { data: accounts, error: accountError } = await supabase
    .from('accounts')
    .select('id, name, owner_user_id')
    .eq('owner_user_id', profile.user_id)

  if (accountError) {
    throw new Error(`Failed to look up account for ${normalized}: ${accountError.message}`)
  }
  const owned = accounts ?? []
  if (owned.length === 0) {
    throw new Error(`${normalized} is not an account owner`)
  }
  if (owned.length > 1) {
    throw new Error(`${normalized} owns more than one account`)
  }

  return {
    accountId: owned[0].id,
    ownerUserId: owned[0].owner_user_id,
    email: profile.email,
    name: owned[0].name,
  }
}

export async function listShopifyOrderTemplates(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ShopifyTemplateRow[]> {
  const { data, error } = await supabase
    .from('message_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('account_id', accountId)
    .like('name', 'shopify_%')
    .order('name')

  if (error) {
    throw new Error(`Failed to list Shopify templates: ${error.message}`)
  }
  return ((data ?? []) as ShopifyTemplateRow[]).filter((row) =>
    isShopifyTemplateName(row.name),
  )
}

export async function listNotificationRules(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ShopifyRuleRow[]> {
  const { data, error } = await supabase
    .from('shopify_notification_rules')
    .select(RULE_COLUMNS)
    .eq('account_id', accountId)
    .order('trigger_key')

  if (error) {
    throw new Error(`Failed to list notification rules: ${error.message}`)
  }
  return (data ?? []) as ShopifyRuleRow[]
}

export async function loadWhatsAppConfig(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ waba_id: string; status: string | null }> {
  const { data, error } = await supabase
    .from('whatsapp_config')
    .select('waba_id, status')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load WhatsApp config: ${error.message}`)
  }
  if (!data) {
    throw new Error(
      'Destination WhatsApp is not configured. Connect WhatsApp in Settings first.',
    )
  }
  const wabaId = typeof data.waba_id === 'string' ? data.waba_id.trim() : ''
  if (!wabaId) {
    throw new Error(
      'Destination WABA ID is missing. Re-connect WhatsApp in Settings.',
    )
  }
  return { waba_id: wabaId, status: data.status ?? null }
}

export function toTemplatePayload(row: ShopifyTemplateRow): TemplatePayload {
  const payload: TemplatePayload = {
    name: row.name,
    category: row.category,
    language: row.language || 'en_US',
    body_text: row.body_text,
  }
  if (row.header_type) payload.header_type = row.header_type
  if (row.header_content) payload.header_content = row.header_content
  if (row.header_media_url) payload.header_media_url = row.header_media_url
  if (row.header_handle) payload.header_handle = row.header_handle
  if (row.footer_text) payload.footer_text = row.footer_text
  if (row.buttons?.length) payload.buttons = row.buttons
  if (row.sample_values) payload.sample_values = row.sample_values
  return payload
}

export function buildClonedTemplateRow(
  row: ShopifyTemplateRow,
  destAccountId: string,
  destOwnerUserId: string,
) {
  return {
    account_id: destAccountId,
    user_id: destOwnerUserId,
    name: row.name,
    category: row.category,
    language: row.language || 'en_US',
    header_type: row.header_type ?? null,
    header_content: row.header_content ?? null,
    header_media_url: row.header_media_url ?? null,
    header_handle: row.header_handle ?? null,
    body_text: row.body_text,
    footer_text: row.footer_text ?? null,
    buttons: row.buttons ?? null,
    sample_values: row.sample_values ?? null,
    status: 'DRAFT',
    meta_template_id: null,
    submission_error: null,
    rejection_reason: null,
  }
}

export function buildClonedRuleRow(row: ShopifyRuleRow, destAccountId: string) {
  return {
    account_id: destAccountId,
    trigger_key: row.trigger_key,
    is_enabled: row.is_enabled,
    template_name: row.template_name,
    template_language: row.template_language || 'en_US',
    variable_map: row.variable_map ?? {},
    config: row.config ?? {},
  }
}

function templateKey(name: string, language: string) {
  return `${name}::${language || 'en_US'}`
}

export async function cloneTemplatesToAccount(
  supabase: SupabaseClient,
  args: {
    sourceTemplates: ShopifyTemplateRow[]
    destAccountId: string
    destOwnerUserId: string
    overwrite: boolean
  },
): Promise<{ cloned: ShopifyTemplateRow[]; skipped: ShopifyTemplateRow[] }> {
  const { sourceTemplates, destAccountId, destOwnerUserId, overwrite } = args
  const existing = await listShopifyOrderTemplates(supabase, destAccountId)
  const existingKeys = new Set(
    existing.map((row) => templateKey(row.name, row.language)),
  )

  const cloned: ShopifyTemplateRow[] = []
  const skipped: ShopifyTemplateRow[] = []

  for (const source of sourceTemplates) {
    const key = templateKey(source.name, source.language)
    if (!overwrite && existingKeys.has(key)) {
      skipped.push(source)
      continue
    }
    const row = buildClonedTemplateRow(source, destAccountId, destOwnerUserId)
    const { data, error } = await supabase
      .from('message_templates')
      .upsert(row, { onConflict: 'user_id,name,language' })
      .select(TEMPLATE_COLUMNS)
      .single()
    if (error) {
      throw new Error(
        `Failed to clone ${source.name} (${source.language}): ${error.message}`,
      )
    }
    cloned.push((data ?? { ...source, ...row, id: source.id }) as ShopifyTemplateRow)
  }

  return { cloned, skipped }
}

export async function cloneNotificationRulesToAccount(
  supabase: SupabaseClient,
  args: {
    sourceRules: ShopifyRuleRow[]
    destAccountId: string
  },
): Promise<number> {
  if (args.sourceRules.length === 0) return 0
  const rows = args.sourceRules.map((rule) =>
    buildClonedRuleRow(rule, args.destAccountId),
  )
  const { error } = await supabase
    .from('shopify_notification_rules')
    .upsert(rows, { onConflict: 'account_id,trigger_key' })
  if (error) {
    throw new Error(`Failed to clone notification rules: ${error.message}`)
  }
  return rows.length
}
