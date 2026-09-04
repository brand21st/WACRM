import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const findExistingContact = vi.fn()
const findCommerceOrder = vi.fn()

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: (...args: unknown[]) => findExistingContact(...args),
}))

vi.mock('./fulfillment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fulfillment')>()
  return {
    ...actual,
    findCommerceOrder: (...args: unknown[]) => findCommerceOrder(...args),
  }
})

import {
  isWhatsAppCommerceShopifyOrder,
  markContactShopifyPaid,
  markContactWhatsAppPaid,
  markShopifyStorePaidFromWebhook,
} from './paid-labels'
import {
  VACHAT_ORDER_TAG,
  WHATSAPP_COMMERCE_DISPLAY_TAG,
  WHATSAPP_COMMERCE_TAG,
} from './shopify-order'

describe('isWhatsAppCommerceShopifyOrder', () => {
  it('is false for store-only tags', () => {
    expect(isWhatsAppCommerceShopifyOrder([])).toBe(false)
    expect(isWhatsAppCommerceShopifyOrder(['vip', 'repeat'])).toBe(false)
  })

  it('is true for WhatsApp commerce tags', () => {
    expect(isWhatsAppCommerceShopifyOrder([WHATSAPP_COMMERCE_TAG])).toBe(true)
    expect(isWhatsAppCommerceShopifyOrder([WHATSAPP_COMMERCE_DISPLAY_TAG])).toBe(
      true,
    )
    expect(isWhatsAppCommerceShopifyOrder([VACHAT_ORDER_TAG])).toBe(true)
    expect(isWhatsAppCommerceShopifyOrder(['wac_abc123'])).toBe(true)
  })
})

describe('markContactWhatsAppPaid / markContactShopifyPaid', () => {
  it('writes only when the paid column is still null', async () => {
    const db = fakeContactsDb()
    await expect(
      markContactWhatsAppPaid(db, 'acct-1', 'c-1'),
    ).resolves.toBe(true)
    expect(db.lastUpdate).toEqual({
      table: 'contacts',
      payload: { wa_commerce_paid_at: expect.any(String) },
      filters: {
        id: 'c-1',
        account_id: 'acct-1',
        wa_commerce_paid_at: null,
      },
    })

    await expect(
      markContactShopifyPaid(db, 'acct-1', 'c-1'),
    ).resolves.toBe(true)
    expect(db.lastUpdate?.payload).toEqual({
      shopify_paid_at: expect.any(String),
    })
    expect(db.lastUpdate?.filters.shopify_paid_at).toBeNull()
  })

  it('returns false when the column is missing', async () => {
    const db = fakeContactsDb({
      error: { code: '42703', message: 'column wa_commerce_paid_at does not exist' },
    })
    await expect(
      markContactWhatsAppPaid(db, 'acct-1', 'c-1'),
    ).resolves.toBe(false)
  })
})

describe('markShopifyStorePaidFromWebhook', () => {
  beforeEach(() => {
    findExistingContact.mockReset()
    findCommerceOrder.mockReset()
    findCommerceOrder.mockResolvedValue(null)
    findExistingContact.mockResolvedValue({ id: 'c-1', phone: '+919876543210' })
  })

  it('skips WhatsApp-commerce tagged orders', async () => {
    const db = fakeContactsDb()
    await expect(
      markShopifyStorePaidFromWebhook({
        db,
        accountId: 'acct-1',
        body: {
          id: 11,
          admin_graphql_api_id: 'gid://shopify/Order/11',
          tags: 'whatsapp-commerce, VaChat Order',
          phone: '+919876543210',
        },
      }),
    ).resolves.toBe(false)
    expect(findCommerceOrder).not.toHaveBeenCalled()
    expect(findExistingContact).not.toHaveBeenCalled()
    expect(db.lastUpdate).toBeNull()
  })

  it('skips when the order is already in the WhatsApp commerce ledger', async () => {
    findCommerceOrder.mockResolvedValue({ id: 'ord-1' })
    const db = fakeContactsDb()
    await expect(
      markShopifyStorePaidFromWebhook({
        db,
        accountId: 'acct-1',
        body: {
          id: 11,
          admin_graphql_api_id: 'gid://shopify/Order/11',
          tags: '',
          phone: '+919876543210',
        },
      }),
    ).resolves.toBe(false)
    expect(findExistingContact).not.toHaveBeenCalled()
    expect(db.lastUpdate).toBeNull()
  })

  it('marks an existing contact for a store checkout', async () => {
    const db = fakeContactsDb()
    await expect(
      markShopifyStorePaidFromWebhook({
        db,
        accountId: 'acct-1',
        body: {
          id: 22,
          admin_graphql_api_id: 'gid://shopify/Order/22',
          name: '#1022',
          tags: 'website',
          phone: '+919876543210',
        },
      }),
    ).resolves.toBe(true)
    expect(findExistingContact).toHaveBeenCalledWith(
      db,
      'acct-1',
      '+919876543210',
    )
    expect(db.lastUpdate?.payload).toEqual({
      shopify_paid_at: expect.any(String),
    })
  })

  it('does not create a contact when none exists', async () => {
    findExistingContact.mockResolvedValue(null)
    const db = fakeContactsDb()
    await expect(
      markShopifyStorePaidFromWebhook({
        db,
        accountId: 'acct-1',
        body: {
          id: 22,
          admin_graphql_api_id: 'gid://shopify/Order/22',
          phone: '+919876543210',
        },
      }),
    ).resolves.toBe(false)
    expect(db.lastUpdate).toBeNull()
  })
})

function fakeContactsDb(options: { error?: { code?: string; message: string } | null } = {}) {
  const state: {
    lastUpdate: {
      table: string
      payload: Record<string, unknown>
      filters: Record<string, unknown>
    } | null
  } = { lastUpdate: null }

  const db = {
    lastUpdate: null as (typeof state)['lastUpdate'],
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let payload: Record<string, unknown> = {}
      const builder = {
        update(next: Record<string, unknown>) {
          payload = next
          return builder
        },
        eq(column: string, value: unknown) {
          filters[column] = value
          return builder
        },
        is(column: string, value: unknown) {
          filters[column] = value
          state.lastUpdate = { table, payload, filters: { ...filters } }
          db.lastUpdate = state.lastUpdate
          return Promise.resolve({ data: null, error: options.error ?? null })
        },
      }
      return builder
    },
  }

  return db as typeof db & SupabaseClient
}
