import { describe, expect, it } from 'vitest'
import type { CatalogProduct } from './core/types'
import {
  CATALOG_SCHEMA_MISSING,
  catalogProductToListItem,
  catalogSchemaMissingResponse,
  isCatalogSchemaError,
  parseCatalogListLimit,
  parseCatalogListOffset,
  parseCatalogListStatus,
} from './http'

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'prod-1',
    accountId: 'acct-1',
    handle: 'red-bag',
    title: 'Red bag',
    description: '',
    status: 'active',
    brand: null,
    productUrl: null,
    currency: 'INR',
    priceMin: 100,
    priceMax: 200,
    origin: 'shopify_import',
    locked: false,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: [
      {
        id: 'var-1',
        accountId: 'acct-1',
        productId: 'prod-1',
        title: 'Default',
        sku: 'RB-1',
        price: 100,
        compareAtPrice: null,
        currency: 'INR',
        available: true,
        inventoryQuantity: 2,
        options: [],
        sortOrder: 0,
        retailerId: 'RB-1',
      },
    ],
    media: [
      {
        id: 'media-1',
        accountId: 'acct-1',
        productId: 'prod-1',
        url: 'https://cdn.example/listing.jpg',
        alt: null,
        role: 'listing',
        sortOrder: 1,
      },
      {
        id: 'media-2',
        accountId: 'acct-1',
        productId: 'prod-1',
        url: 'https://cdn.example/hero.jpg',
        alt: 'Hero',
        role: 'hero',
        sortOrder: 0,
      },
    ],
    externalIds: [],
    ...overrides,
  }
}

describe('catalog http helpers', () => {
  it('maps a catalog product to a list row and prefers the hero image', () => {
    expect(catalogProductToListItem(product())).toEqual({
      id: 'prod-1',
      title: 'Red bag',
      handle: 'red-bag',
      status: 'active',
      origin: 'shopify_import',
      currency: 'INR',
      priceMin: 100,
      priceMax: 200,
      variantCount: 1,
      imageUrl: 'https://cdn.example/hero.jpg',
    })
  })

  it('falls back to the first image when no hero exists', () => {
    const item = catalogProductToListItem(
      product({
        media: [
          {
            id: 'media-1',
            accountId: 'acct-1',
            productId: 'prod-1',
            url: 'https://cdn.example/listing.jpg',
            alt: null,
            role: 'listing',
            sortOrder: 0,
          },
        ],
      }),
    )
    expect(item.imageUrl).toBe('https://cdn.example/listing.jpg')
  })

  it('parses list query params', () => {
    expect(parseCatalogListStatus(null)).toBeUndefined()
    expect(parseCatalogListStatus('all')).toBeUndefined()
    expect(parseCatalogListStatus('active')).toBe('active')
    expect(parseCatalogListStatus('nope')).toBeUndefined()
    expect(parseCatalogListLimit(null)).toBe(50)
    expect(parseCatalogListLimit('12')).toBe(12)
    expect(parseCatalogListLimit('999')).toBe(100)
    expect(parseCatalogListLimit('0')).toBe(1)
    expect(parseCatalogListOffset(null)).toBe(0)
    expect(parseCatalogListOffset('20')).toBe(20)
    expect(parseCatalogListOffset('-4')).toBe(0)
  })

  it('detects a missing catalog_products relation', () => {
    expect(
      isCatalogSchemaError({
        code: '42P01',
        message: 'relation "catalog_products" does not exist',
      }),
    ).toBe(true)
    expect(isCatalogSchemaError({ code: 'PGRST205', message: 'not found' })).toBe(
      true,
    )
    expect(isCatalogSchemaError({ message: 'permission denied' })).toBe(false)
  })

  it('returns the 503 schema-missing payload', async () => {
    const res = catalogSchemaMissingResponse()
    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: 'Catalog is not ready yet',
      code: CATALOG_SCHEMA_MISSING,
    })
  })
})
