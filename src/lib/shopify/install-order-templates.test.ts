import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  submitTemplateForAccount: vi.fn(),
}))

vi.mock('@/lib/whatsapp/submit-template-for-account', () => ({
  submitTemplateForAccount: (...args: unknown[]) =>
    mocks.submitTemplateForAccount(...args),
}))

import {
  installShopifyOrderTemplates,
  nextInstallRule,
  shouldEnablePendingPresetRule,
} from './install-order-templates'
import { SHOPIFY_NOTIFICATION_TRIGGERS } from './notification-triggers'
import { presetForTrigger } from './notification-templates'

function approvedPresets() {
  return SHOPIFY_NOTIFICATION_TRIGGERS.map((trigger) => ({
    name: presetForTrigger(trigger).name,
    language: 'en_US',
    status: 'APPROVED' as const,
  }))
}

function makeSupabase(opts: {
  wabaId?: string | null
  ownerUserId?: string | null
  templates?: Array<{ name: string; language: string; status: string }>
  rules?: unknown[]
}) {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn((table: string) => {
    if (table === 'whatsapp_config') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.wabaId ? { waba_id: opts.wabaId } : null,
                error: null,
              }),
          }),
        }),
      }
    }
    if (table === 'accounts') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: opts.ownerUserId
                  ? { owner_user_id: opts.ownerUserId }
                  : null,
                error: null,
              }),
          }),
        }),
      }
    }
    if (table === 'message_templates') {
      return {
        select: () => ({
          eq: () => ({
            like: () =>
              Promise.resolve({ data: opts.templates ?? [], error: null }),
          }),
        }),
      }
    }
    if (table === 'shopify_notification_rules') {
      return {
        select: () => ({
          eq: () => Promise.resolve({ data: opts.rules ?? [], error: null }),
        }),
        upsert,
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { supabase: { from } as never, upsert }
}

describe('nextInstallRule', () => {
  it('enables a new rule only when the template is APPROVED', () => {
    const pending = nextInstallRule('new_order', undefined, {
      name: 'shopify_new_order',
      language: 'en_US',
      status: 'PENDING',
    })
    expect(pending.is_enabled).toBe(false)
    expect(pending.template_name).toBe('shopify_new_order')

    const approved = nextInstallRule('new_order', undefined, {
      name: 'shopify_new_order',
      language: 'en_US',
      status: 'APPROVED',
    })
    expect(approved.is_enabled).toBe(true)
  })

  it('does not re-enable a merchant-disabled custom template', () => {
    const next = nextInstallRule(
      'new_order',
      {
        trigger_key: 'new_order',
        is_enabled: false,
        template_name: 'custom_order_ping',
        template_language: 'en_US',
        variable_map: { '1': 'order_name' },
        config: {},
      },
      { name: 'shopify_new_order', language: 'en_US', status: 'APPROVED' },
    )
    expect(next.is_enabled).toBe(false)
    expect(next.template_name).toBe('custom_order_ping')
  })
})

describe('shouldEnablePendingPresetRule', () => {
  it('enables a pending preset rule for the approved template name', () => {
    expect(
      shouldEnablePendingPresetRule(
        {
          trigger_key: 'new_order',
          is_enabled: false,
          template_name: 'shopify_new_order',
        },
        'shopify_new_order',
      ),
    ).toBe(true)
  })

  it('skips already-enabled rules', () => {
    expect(
      shouldEnablePendingPresetRule(
        {
          trigger_key: 'new_order',
          is_enabled: true,
          template_name: 'shopify_new_order',
        },
        'shopify_new_order',
      ),
    ).toBe(false)
  })
})

describe('installShopifyOrderTemplates', () => {
  beforeEach(() => {
    mocks.submitTemplateForAccount.mockReset()
  })

  it('no-ops without a WABA', async () => {
    const { supabase, upsert } = makeSupabase({ wabaId: null })
    const result = await installShopifyOrderTemplates(supabase, {
      accountId: 'acct-1',
    })
    expect(result.skippedReason).toBe('no_waba')
    expect(mocks.submitTemplateForAccount).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('skips submit when all presets already exist', async () => {
    const { supabase, upsert } = makeSupabase({
      wabaId: 'waba-1',
      ownerUserId: 'user-1',
      templates: approvedPresets(),
      rules: [],
    })
    const result = await installShopifyOrderTemplates(supabase, {
      accountId: 'acct-1',
    })
    expect(mocks.submitTemplateForAccount).not.toHaveBeenCalled()
    expect(result.submitted).toEqual([])
    expect(result.alreadyPresent).toHaveLength(SHOPIFY_NOTIFICATION_TRIGGERS.length)
    expect(upsert).toHaveBeenCalled()
    const rows = upsert.mock.calls[0][0] as Array<{ is_enabled: boolean }>
    expect(rows.every((row) => row.is_enabled)).toBe(true)
  })

  it('submits only missing preset names', async () => {
    mocks.submitTemplateForAccount.mockResolvedValue({
      ok: true,
      template: { status: 'PENDING', name: 'shopify_new_order' },
      dry_run: false,
    })
    const present = approvedPresets().filter(
      (row) => row.name !== 'shopify_new_order',
    )
    const { supabase } = makeSupabase({
      wabaId: 'waba-1',
      ownerUserId: 'user-1',
      templates: present,
      rules: [],
    })
    const result = await installShopifyOrderTemplates(supabase, {
      accountId: 'acct-1',
      ownerUserId: 'user-1',
    })
    expect(mocks.submitTemplateForAccount).toHaveBeenCalledTimes(1)
    expect(result.submitted).toEqual(['shopify_new_order'])
    expect(result.alreadyPresent).not.toContain('shopify_new_order')
  })
})
