import type { MessageTemplate, TemplateButton, TemplateSampleValues } from '@/types'
import { TEMPLATE_LIMITS, type TemplatePayload } from '@/lib/whatsapp/template-validators'
import { type ShopifyNotificationTrigger } from './notification-triggers'

export interface ShopifyTemplatePreset {
  trigger: ShopifyNotificationTrigger
  name: string
  category: MessageTemplate['category']
  language: string
  body_text: string
  sampleBody: string[]
  buttons?: TemplateButton[]
}

export const SHOPIFY_TEMPLATE_PRESETS: Record<
  ShopifyNotificationTrigger,
  ShopifyTemplatePreset
> = {
  new_order: {
    trigger: 'new_order',
    name: 'shopify_new_order',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, thanks for your order {{2}}. Total: {{3}}. We will update you when it ships.',
    sampleBody: ['Ada', '#1001', '2499 INR'],
  },
  processing: {
    trigger: 'processing',
    name: 'shopify_processing',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, we have received payment for order {{2}} ({{3}}) and are preparing it for dispatch.',
    sampleBody: ['Ada', '#1001', '2499 INR'],
  },
  checkout_abandoned: {
    trigger: 'checkout_abandoned',
    name: 'shopify_checkout_abandoned',
    category: 'Marketing',
    language: 'en_US',
    body_text:
      'Hi {{1}}, you left items in your cart. Complete your order here: {{2}} Use code {{3}} at checkout.',
    sampleBody: ['Ada', 'https://shop.example/checkouts/abc', 'SAVE10'],
    buttons: [{ type: 'COPY_CODE', text: 'Copy code', example: 'SAVE10' }],
  },
  fulfilled: {
    trigger: 'fulfilled',
    name: 'shopify_fulfilled',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Order {{1}} is on its way. Tracking number: {{2}}. Track it here: {{3}}',
    sampleBody: ['#1001', '1Z999', 'https://track.example/1Z999'],
  },
  tracking: {
    trigger: 'tracking',
    name: 'shopify_tracking',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Tracking update for order {{1}}. Number: {{2}}. Track: {{3}}',
    sampleBody: ['#1001', '1Z999', 'https://track.example/1Z999'],
  },
  delivered: {
    trigger: 'delivered',
    name: 'shopify_delivered',
    category: 'Utility',
    language: 'en_US',
    body_text: 'Hi {{1}}, order {{2}} has been delivered. We hope you love it.',
    sampleBody: ['Ada', '#1001'],
  },
  after_delivered: {
    trigger: 'after_delivered',
    name: 'shopify_after_delivered',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'Hi {{1}}, how is order {{2}}? Reply here if you need help with size, returns, or anything else.',
    sampleBody: ['Ada', '#1001'],
  },
  refund: {
    trigger: 'refund',
    name: 'shopify_refund',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'A refund of {{2}} has been issued for order {{1}}. It may take a few business days to reach your account.',
    sampleBody: ['#1001', '500 INR'],
  },
  return_request: {
    trigger: 'return_request',
    name: 'shopify_return_request',
    category: 'Utility',
    language: 'en_US',
    body_text:
      'We received your return request for order {{1}}. Our team will follow up with next steps.',
    sampleBody: ['#1001'],
  },
}

export function presetForTrigger(
  trigger: ShopifyNotificationTrigger,
): ShopifyTemplatePreset {
  return SHOPIFY_TEMPLATE_PRESETS[trigger]
}

export function isShopifyTemplateName(name: string): boolean {
  return name.startsWith('shopify_')
}

export function isPresetNameForTrigger(
  name: string,
  trigger: ShopifyNotificationTrigger,
): boolean {
  return name === SHOPIFY_TEMPLATE_PRESETS[trigger].name
}

/** Append merchant notes to preset/body copy. Does not invent {{N}} variables. */
export function applyRequirements(
  body: string,
  notes: string,
  maxLen = TEMPLATE_LIMITS.bodyMaxLength,
): string {
  const base = body.trim()
  const extra = notes.trim()
  if (!extra) return base.slice(0, maxLen)
  const sentence = /[.!?]$/.test(extra) ? extra : `${extra}.`
  const combined = `${base} ${sentence}`.trim()
  if (combined.length <= maxLen) return combined
  const room = maxLen - base.length - 1
  if (room < 1) return base.slice(0, maxLen)
  return `${base} ${sentence.slice(0, room)}`.trim()
}

export function buildPresetSubmitPayload(
  preset: ShopifyTemplatePreset,
  bodyText: string,
  notes: string,
): TemplatePayload {
  const body_text = applyRequirements(bodyText, notes)
  const sample_values: TemplateSampleValues = {
    body: [...preset.sampleBody],
  }
  const payload: TemplatePayload = {
    name: preset.name,
    category: preset.category,
    language: preset.language,
    body_text,
    sample_values,
  }
  if (preset.buttons?.length) payload.buttons = preset.buttons
  return payload
}

export interface ShopifyPickerTemplate {
  id?: string
  name: string
  language: string
  category?: string
  body_text?: string
  status?: string
}

export function templatesForTriggerDropdown(
  templates: ShopifyPickerTemplate[],
  trigger: ShopifyNotificationTrigger,
  selectedName: string | null,
  selectedLanguage: string,
  showAll: boolean,
): ShopifyPickerTemplate[] {
  const presetName = SHOPIFY_TEMPLATE_PRESETS[trigger].name
  const matchesName = (row: ShopifyPickerTemplate) => {
    if (row.name === presetName) return true
    if (isShopifyTemplateName(row.name)) return true
    if (
      selectedName &&
      row.name === selectedName &&
      row.language === selectedLanguage
    ) {
      return true
    }
    return false
  }
  const matchesStatus = (row: ShopifyPickerTemplate) => {
    if (canEnableShopifyTemplate(row.status) || row.status === 'PENDING' || row.status === 'PAUSED') {
      return true
    }
    return Boolean(
      selectedName &&
        row.name === selectedName &&
        row.language === selectedLanguage,
    )
  }
  return templates.filter((row) => (showAll || matchesName(row)) && matchesStatus(row))
}

export function findPresetTemplate(
  templates: ShopifyPickerTemplate[],
  trigger: ShopifyNotificationTrigger,
  preferredLanguage = 'en_US',
): ShopifyPickerTemplate | undefined {
  const presetName = SHOPIFY_TEMPLATE_PRESETS[trigger].name
  const matches = templates.filter((row) => row.name === presetName)
  return (
    matches.find((row) => row.language === preferredLanguage) ??
    matches.find((row) => row.language === 'en_US') ??
    matches[0]
  )
}

export const SHOPIFY_TEMPLATE_PICKER_STATUSES = [
  'APPROVED',
  'PENDING',
  'REJECTED',
  'PAUSED',
] as const

export function canEnableShopifyTemplate(status?: string): boolean {
  return status === 'APPROVED'
}

export function canQuickEditShopifyTemplate(status?: string): boolean {
  return status === 'APPROVED' || status === 'REJECTED' || status === 'PAUSED'
}
