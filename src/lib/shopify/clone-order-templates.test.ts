import { describe, expect, it, vi } from 'vitest'

import {
  buildClonedRuleRow,
  buildClonedTemplateRow,
  cloneTemplatesToAccount,
  resolveAccountByOwnerEmail,
  toTemplatePayload,
  type ShopifyTemplateRow,
} from './clone-order-templates'

const source: ShopifyTemplateRow = {
  id: 'src-1',
  account_id: 'acct-src',
  user_id: 'user-src',
  name: 'shopify_new_order',
  category: 'Utility',
  language: 'en_US',
  header_type: 'text',
  header_content: 'Order update',
  header_media_url: null,
  header_handle: null,
  body_text: 'Hi {{1}}, thanks for order {{2}}. Total: {{3}}.',
  footer_text: 'Samanga',
  buttons: [{ type: 'COPY_CODE', text: 'Copy offer code', example: 'SAVE10' }],
  sample_values: { body: ['Ada', '#1001', '2499 INR'] },
  status: 'APPROVED',
}

describe('resolveAccountByOwnerEmail', () => {
  it('returns the owned account for a unique owner email', async () => {
    const supabase = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              ilike: () =>
                Promise.resolve({
                  data: [
                    {
                      user_id: 'user-src',
                      email: 'samanga@samanga.com',
                      full_name: 'Samanga',
                      account_id: 'acct-src',
                    },
                  ],
                  error: null,
                }),
            }),
          }
        }
        if (table === 'accounts') {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    {
                      id: 'acct-src',
                      name: 'Samanga',
                      owner_user_id: 'user-src',
                    },
                  ],
                  error: null,
                }),
            }),
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    await expect(
      resolveAccountByOwnerEmail(supabase as never, 'samanga@samanga.com'),
    ).resolves.toEqual({
      accountId: 'acct-src',
      ownerUserId: 'user-src',
      email: 'samanga@samanga.com',
      name: 'Samanga',
    })
  })
})

describe('toTemplatePayload', () => {
  it('maps buttons, header, and sample values', () => {
    expect(toTemplatePayload(source)).toEqual({
      name: 'shopify_new_order',
      category: 'Utility',
      language: 'en_US',
      header_type: 'text',
      header_content: 'Order update',
      body_text: 'Hi {{1}}, thanks for order {{2}}. Total: {{3}}.',
      footer_text: 'Samanga',
      buttons: [{ type: 'COPY_CODE', text: 'Copy offer code', example: 'SAVE10' }],
      sample_values: { body: ['Ada', '#1001', '2499 INR'] },
    })
  })
})

describe('buildClonedRuleRow', () => {
  it('preserves variable_map and config on the destination account', () => {
    expect(
      buildClonedRuleRow(
        {
          trigger_key: 'checkout_abandoned',
          is_enabled: true,
          template_name: 'shopify_checkout_abandoned',
          template_language: 'en_US',
          variable_map: { '1': 'customer_first_name', '2': 'checkout_url' },
          config: { delay_hours: 2, discount_code: 'SAVE10' },
        },
        'acct-dest',
      ),
    ).toEqual({
      account_id: 'acct-dest',
      trigger_key: 'checkout_abandoned',
      is_enabled: true,
      template_name: 'shopify_checkout_abandoned',
      template_language: 'en_US',
      variable_map: { '1': 'customer_first_name', '2': 'checkout_url' },
      config: { delay_hours: 2, discount_code: 'SAVE10' },
    })
  })
})

describe('buildClonedTemplateRow', () => {
  it('resets Meta ids and writes under the destination owner', () => {
    const cloned = buildClonedTemplateRow(source, 'acct-dest', 'user-dest')
    expect(cloned.account_id).toBe('acct-dest')
    expect(cloned.user_id).toBe('user-dest')
    expect(cloned.body_text).toBe(source.body_text)
    expect(cloned.status).toBe('DRAFT')
    expect(cloned.meta_template_id).toBeNull()
    expect(cloned.submission_error).toBeNull()
  })
})

describe('cloneTemplatesToAccount', () => {
  it('upserts an existing destination template with the source body', async () => {
    const upsert = vi.fn()
    upsert.mockReturnValue({
      select: () => ({
        single: () =>
          Promise.resolve({
            data: {
              ...buildClonedTemplateRow(source, 'acct-dest', 'user-dest'),
              id: 'dest-1',
            },
            error: null,
          }),
      }),
    })

    const supabase = {
      from: (table: string) => {
        if (table === 'message_templates') {
          return {
            select: () => ({
              eq: () => ({
                like: () => ({
                  order: () =>
                    Promise.resolve({
                      data: [
                        {
                          ...source,
                          id: 'dest-1',
                          account_id: 'acct-dest',
                          user_id: 'user-dest',
                          body_text: 'old body {{1}}',
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
            upsert,
          }
        }
        throw new Error(`unexpected table ${table}`)
      },
    }

    const updated = {
      ...source,
      body_text: 'Hi {{1}}, thanks for order {{2}}. Total: {{3}}.',
    }

    const result = await cloneTemplatesToAccount(supabase as never, {
      sourceTemplates: [updated],
      destAccountId: 'acct-dest',
      destOwnerUserId: 'user-dest',
      overwrite: true,
    })

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].body_text).toBe(updated.body_text)
    expect(upsert.mock.calls[0][0].user_id).toBe('user-dest')
    expect(result.cloned).toHaveLength(1)
    expect(result.skipped).toHaveLength(0)
  })

  it('skips existing destination templates when overwrite is false', async () => {
    const upsert = vi.fn()
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            like: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      ...source,
                      id: 'dest-1',
                      account_id: 'acct-dest',
                      user_id: 'user-dest',
                    },
                  ],
                  error: null,
                }),
            }),
          }),
        }),
        upsert,
      }),
    }

    const result = await cloneTemplatesToAccount(supabase as never, {
      sourceTemplates: [source],
      destAccountId: 'acct-dest',
      destOwnerUserId: 'user-dest',
      overwrite: false,
    })

    expect(upsert).not.toHaveBeenCalled()
    expect(result.skipped).toHaveLength(1)
    expect(result.cloned).toHaveLength(0)
  })
})
