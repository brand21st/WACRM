import { describe, expect, it, vi } from 'vitest'
import { fetchStorefrontPolicies } from './storefront-content'
import type { ShopifyStoreConfig } from './types'

const STORE: ShopifyStoreConfig = {
  accountId: 'account-1',
  shopDomain: 'acme.myshopify.com',
  accessToken: 't',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'USD',
  metaCatalogId: null,
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 0,
}

describe('fetchStorefrontPolicies', () => {
  it('reads public /policies pages when Admin API is unavailable', async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.includes('refund-policy')) {
        return new Response(
          `<div class="shopify-policy__body"><div class="rte"><p>Returns in 30 days. Unused items can be sent back with the original invoice for a refund to the original payment method.</p></div></div>`,
          { status: 200 },
        )
      }
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch

    const rows = await fetchStorefrontPolicies(
      STORE,
      STORE.accountId,
      '2026-01-01T00:00:00Z',
      fetchImpl,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      kind: 'policy',
      handle: 'refund-policy',
      title: 'Refund Policy',
    })
    expect(String(rows[0]?.body)).toMatch(/Returns in 30 days/)
  })
})
