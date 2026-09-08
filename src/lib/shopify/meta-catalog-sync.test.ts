import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const enqueueFullCatalogMetaSync = vi.fn().mockResolvedValue({ queued: 4 })

vi.mock('@/lib/catalog/sync/full-sync', () => ({
  enqueueFullCatalogMetaSync: (...args: unknown[]) =>
    enqueueFullCatalogMetaSync(...args),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'wa-token',
  encrypt: (value: string) => value,
}))

import {
  catalogIdLooksLikeWhatsAppAsset,
  catalogItemsFromProduct,
  collectionReviewFromMetadata,
  explainMetaCatalogSyncError,
  syncMetaCatalog,
} from './meta-catalog-sync'
import type { ShopifyProductHit } from './types'

const product: ShopifyProductHit = {
  id: 'gid://shopify/Product/42',
  handle: 'red-bag',
  title: 'Red Bag',
  description: 'Leather tote',
  imageUrl: 'https://cdn.example/bag.jpg',
  productUrl: 'https://shop.example/products/red-bag',
  cartUrl: null,
  checkoutUrl: null,
  priceMin: '49.00',
  priceMax: '49.00',
  currency: 'INR',
  variants: [
    {
      id: 'gid://shopify/ProductVariant/9',
      variantId: '99',
      title: 'Default',
      sku: 'BAG-RED',
      price: '49.00',
      compareAtPrice: null,
      available: true,
      options: [],
    },
  ],
}

describe('catalogItemsFromProduct', () => {
  it('maps Shopify variants to Meta catalog items with major-unit prices', () => {
    const items = catalogItemsFromProduct(product, 'sku', 'Acme')
    expect(items).toEqual([
      expect.objectContaining({
        retailer_id: 'BAG-RED',
        name: 'Red Bag',
        availability: 'in stock',
        price: 49,
        currency: 'INR',
        url: 'https://shop.example/products/red-bag',
        brand: 'Acme',
      }),
    ])
  })
})

describe('catalogIdLooksLikeWhatsAppAsset', () => {
  it('rejects a pasted phone number id or WABA id', () => {
    expect(
      catalogIdLooksLikeWhatsAppAsset('1273107552556381', '1273107552556381', '1754381179136878'),
    ).toMatch(/Phone Number ID/)
    expect(
      catalogIdLooksLikeWhatsAppAsset('1754381179136878', '1273107552556381', '1754381179136878'),
    ).toMatch(/Business Account ID/)
    expect(
      catalogIdLooksLikeWhatsAppAsset('999', '1273107552556381', '1754381179136878'),
    ).toBeNull()
  })
})

describe('explainMetaCatalogSyncError', () => {
  it('rewrites Graph object-not-found errors with Commerce Manager guidance', () => {
    const message = explainMetaCatalogSyncError({
      catalogId: '1537621380970509',
      graphMessage:
        "Unsupported post request. Object with ID '1537621380970509' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
      phoneNumberId: '1273107552556381',
      wabaId: '1754381179136878',
      connected: { status: 'ok', catalogs: [{ id: '111222333', name: 'Store catalog' }] },
    })
    expect(message).toMatch(/Commerce Manager/)
    expect(message).toMatch(/catalog_management/)
    expect(message).toMatch(/111222333/)
    expect(message).not.toMatch(/Unsupported post request/)
  })

  it('blames the missing catalog_management scope, not the catalog', () => {
    const message = explainMetaCatalogSyncError({
      catalogId: '1537621380970509',
      graphMessage: '(#100) Missing Permission',
      phoneNumberId: '1273107552556381',
      wabaId: '1754381179136878',
      // The probe is blocked by the very same missing scope.
      connected: {
        status: 'unavailable',
        reason:
          '(#100) This application has not been approved to use this api. Please check the application capabilities or access token permissions.',
      },
    })
    expect(message).toMatch(/catalog_management/)
    expect(message).toMatch(/System users/)
    expect(message).not.toMatch(/No product catalog is connected/)
  })

  it('does not claim a catalog is missing when the check itself failed', () => {
    const message = explainMetaCatalogSyncError({
      catalogId: '1537621380970509',
      graphMessage: 'Temporary Graph outage',
      phoneNumberId: '1273107552556381',
      wabaId: '1754381179136878',
      connected: { status: 'unavailable', reason: 'Graph returned 500.' },
    })
    expect(message).toMatch(/Could not check which catalogs are connected/)
    expect(message).not.toMatch(/No product catalog is connected/)
  })
})

describe('syncMetaCatalog', () => {
  beforeEach(() => {
    enqueueFullCatalogMetaSync.mockReset().mockResolvedValue({ queued: 4 })
  })

  it('enqueues a WACRM full sync and does not require Shopify', async () => {
    const from = vi.fn((table: string) => {
      if (table === 'shopify_configs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  meta_catalog_id: 'cat-1',
                  meta_catalog_auto_sync: false,
                  retailer_id_source: 'sku',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  access_token: 'encrypted',
                  phone_number_id: 'pn',
                  waba_id: 'waba',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    const db = { from } as unknown as SupabaseClient
    const result = await syncMetaCatalog(db, 'acct-a')
    expect(result.count).toBe(4)
    expect(enqueueFullCatalogMetaSync).toHaveBeenCalledWith(db, 'acct-a')
    expect(from).not.toHaveBeenCalledWith('shopify_catalog_products')
  })
})

describe('collectionReviewFromMetadata', () => {
  it('is live when live_metadata is present and pending when only latest exists', () => {
    expect(
      collectionReviewFromMetadata({
        latestMetadata: { description: 'Kurti' },
        liveMetadata: { description: 'Kurti', cover_image_url: 'https://cdn.example/k.jpg' },
      }),
    ).toBe('live')
    expect(
      collectionReviewFromMetadata({
        latestMetadata: { description: 'Kurti' },
        liveMetadata: null,
      }),
    ).toBe('pending')
    expect(collectionReviewFromMetadata({})).toBeNull()
  })
})
