import { describe, expect, it } from 'vitest'

import {
  extractVariableIndices,
  TEMPLATE_LIMITS,
  validateTemplatePayload,
} from '@/lib/whatsapp/template-validators'
import { DEFAULT_VARIABLE_MAPS, SHOPIFY_NOTIFICATION_TRIGGERS } from './notification-triggers'
import {
  applyRequirements,
  buildPresetSubmitPayload,
  isPresetNameForTrigger,
  isShopifyTemplateName,
  presetForTrigger,
  SHOPIFY_TEMPLATE_PRESETS,
  templatesForTriggerDropdown,
  triggersMissingPresets,
} from './notification-templates'

describe('Shopify template presets', () => {
  it('uses Meta-safe names and matching {{N}} counts', () => {
    for (const trigger of SHOPIFY_NOTIFICATION_TRIGGERS) {
      const preset = presetForTrigger(trigger)
      expect(TEMPLATE_LIMITS.nameRegex.test(preset.name)).toBe(true)
      expect(isShopifyTemplateName(preset.name)).toBe(true)
      expect(isPresetNameForTrigger(preset.name, trigger)).toBe(true)
      const indices = extractVariableIndices(preset.body_text)
      const mapKeys = Object.keys(DEFAULT_VARIABLE_MAPS[trigger]).map(Number)
      expect(indices).toEqual(mapKeys.sort((a, b) => a - b))
      expect(preset.sampleBody).toHaveLength(indices.length)
      expect(preset.body_text.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.bodyMaxLength)
      expect(() =>
        validateTemplatePayload(buildPresetSubmitPayload(preset, preset.body_text, '')),
      ).not.toThrow()
    }
  })

  it('marks abandoned checkout as Marketing with a COPY_CODE button', () => {
    const preset = SHOPIFY_TEMPLATE_PRESETS.checkout_abandoned
    expect(preset.category).toBe('Marketing')
    expect(preset.buttons?.[0]).toMatchObject({
      type: 'COPY_CODE',
      text: 'Copy offer code',
      example: 'SAVE10',
    })
  })

  it('uses Utility for order-status templates', () => {
    expect(SHOPIFY_TEMPLATE_PRESETS.new_order.category).toBe('Utility')
    expect(SHOPIFY_TEMPLATE_PRESETS.delivered.category).toBe('Utility')
    expect(SHOPIFY_TEMPLATE_PRESETS.cancelled.category).toBe('Utility')
    expect(SHOPIFY_TEMPLATE_PRESETS.partially_fulfilled.category).toBe('Utility')
  })

  it('lists triggers whose shopify_* preset is missing', () => {
    expect(triggersMissingPresets([])).toHaveLength(SHOPIFY_NOTIFICATION_TRIGGERS.length)
    expect(
      triggersMissingPresets([
        { name: 'shopify_new_order', language: 'en_US', status: 'PENDING' },
      ]),
    ).not.toContain('new_order')
  })
})

describe('applyRequirements', () => {
  it('appends notes as a sentence', () => {
    expect(applyRequirements('Hi {{1}}.', 'Free shipping in Kerala')).toBe(
      'Hi {{1}}. Free shipping in Kerala.',
    )
  })

  it('does not duplicate a trailing period', () => {
    expect(applyRequirements('Hi {{1}}.', 'Ships in 5-10 days.')).toBe(
      'Hi {{1}}. Ships in 5-10 days.',
    )
  })

  it('caps body length', () => {
    const notes = 'x'.repeat(2000)
    const out = applyRequirements('Hello.', notes, 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.startsWith('Hello.')).toBe(true)
  })
})

describe('buildPresetSubmitPayload', () => {
  it('keeps preset name and merges requirements into the body', () => {
    const preset = SHOPIFY_TEMPLATE_PRESETS.new_order
    const payload = buildPresetSubmitPayload(preset, preset.body_text, 'Ships in 5-10 days')
    expect(payload.name).toBe('shopify_new_order')
    expect(payload.body_text).toContain('{{1}}')
    expect(payload.body_text).toContain('Ships in 5-10 days.')
    expect(payload.sample_values?.body).toEqual(preset.sampleBody)
  })
})

describe('templatesForTriggerDropdown', () => {
  const rows = [
    { name: 'shopify_new_order', language: 'en_US', status: 'APPROVED' },
    { name: 'welcome', language: 'en_US', status: 'APPROVED' },
    { name: 'promo', language: 'en', status: 'APPROVED' },
  ]

  it('keeps shopify_* templates and the current selection', () => {
    const filtered = templatesForTriggerDropdown(
      rows,
      'new_order',
      'promo',
      'en',
      false,
    )
    expect(filtered.map((r) => r.name).sort()).toEqual(['promo', 'shopify_new_order'])
  })

  it('returns the full list when showAll is on', () => {
    expect(
      templatesForTriggerDropdown(rows, 'new_order', null, 'en_US', true),
    ).toHaveLength(3)
  })

  it('hides rejected templates unless they are the current pick', () => {
    const withRejected = [
      ...rows,
      { name: 'shopify_processing', language: 'en_US', status: 'REJECTED' },
    ]
    expect(
      templatesForTriggerDropdown(withRejected, 'processing', null, 'en_US', false).map(
        (r) => r.name,
      ),
    ).toEqual(['shopify_new_order'])
    expect(
      templatesForTriggerDropdown(
        withRejected,
        'processing',
        'shopify_processing',
        'en_US',
        false,
      ).map((r) => r.name),
    ).toContain('shopify_processing')
  })
})
