import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const enqueueCatalogProductUpsert = vi.fn().mockResolvedValue('outbox-1')
const enqueueCatalogProductDelete = vi.fn().mockResolvedValue('outbox-2')
const scheduleCatalogEmbed = vi.fn().mockResolvedValue(undefined)

const enqueueCatalogSetUpsert = vi.fn().mockResolvedValue('outbox-set')
const enqueueCatalogSetUpserts = vi.fn().mockResolvedValue(undefined)
const enqueueCatalogSetDelete = vi.fn().mockResolvedValue('outbox-set-del')

vi.mock('@/lib/catalog/sync/outbox', () => ({
  enqueueCatalogProductUpsert: (...args: unknown[]) =>
    enqueueCatalogProductUpsert(...args),
  enqueueCatalogProductDelete: (...args: unknown[]) =>
    enqueueCatalogProductDelete(...args),
  enqueueCatalogSetUpsert: (...args: unknown[]) =>
    enqueueCatalogSetUpsert(...args),
  enqueueCatalogSetUpserts: (...args: unknown[]) =>
    enqueueCatalogSetUpserts(...args),
  enqueueCatalogSetDelete: (...args: unknown[]) =>
    enqueueCatalogSetDelete(...args),
}))

vi.mock('@/lib/catalog/embeddings/jobs', () => ({
  scheduleCatalogEmbed: (...args: unknown[]) => scheduleCatalogEmbed(...args),
}))

vi.mock('@/lib/catalog/sync/product-sets', () => ({
  publishCatalogSetToMeta: vi.fn(),
  deleteCatalogSetOnMeta: vi.fn(),
  republishCatalogSets: vi.fn(),
  publishAllCatalogSetsToMeta: vi.fn(),
}))

import {
  deleteProduct,
  replaceImportedAccountProducts,
  upsertProduct,
} from './commands'
import { getProductByHandle, getProductById, getProductByRetailerId } from './repository'
import type { CatalogProductDraft } from './types'

function draft(overrides: Partial<CatalogProductDraft> = {}): CatalogProductDraft {
  return {
    accountId: 'acct-a',
    handle: 'red-bag',
    title: 'Red Bag',
    description: 'Leather tote',
    status: 'active',
    origin: 'shopify_import',
    locked: false,
    currency: 'INR',
    priceMin: 49,
    priceMax: 49,
    variants: [
      {
        title: 'Default',
        sku: 'BAG-RED',
        price: 49,
        available: true,
        options: [{ name: 'Color', value: 'Red' }],
        sortOrder: 0,
        retailerId: 'BAG-RED',
        externalIds: [{ source: 'shopify', entity: 'variant', externalId: '99' }],
      },
    ],
    media: [{ url: 'https://cdn.example/bag.jpg', role: 'hero', sortOrder: 0 }],
    externalIds: [
      { source: 'shopify', entity: 'product', externalId: 'gid://shopify/Product/42' },
      { source: 'shopify', entity: 'product', externalId: '42' },
    ],
    ...overrides,
  }
}

describe('catalog commands', () => {
  afterEach(() => {
    enqueueCatalogProductUpsert.mockReset().mockResolvedValue('outbox-1')
    enqueueCatalogProductDelete.mockReset().mockResolvedValue('outbox-2')
    enqueueCatalogSetUpsert.mockReset().mockResolvedValue('outbox-set')
    enqueueCatalogSetUpserts.mockReset().mockResolvedValue(undefined)
    enqueueCatalogSetDelete.mockReset().mockResolvedValue('outbox-set-del')
    scheduleCatalogEmbed.mockReset().mockResolvedValue(undefined)
  })

  it('creates a product with variants, media, and external ids', async () => {
    const db = createMemoryDb()
    const product = await upsertProduct(db, draft())
    expect(product?.title).toBe('Red Bag')
    expect(product?.origin).toBe('shopify_import')
    expect(product?.variants[0]?.retailerId).toBe('BAG-RED')
    expect(product?.media[0]?.url).toBe('https://cdn.example/bag.jpg')
    expect(product?.externalIds.map((e) => e.externalId)).toEqual(
      expect.arrayContaining(['gid://shopify/Product/42', '42']),
    )
  })

  it('updates an existing imported product by Shopify external id', async () => {
    const db = createMemoryDb()
    const first = await upsertProduct(db, draft())
    const second = await upsertProduct(
      db,
      draft({
        handle: 'red-bag-v2',
        title: 'Red Bag Deluxe',
        variants: [
          {
            title: 'Large',
            sku: 'BAG-RED',
            price: 59,
            available: true,
            retailerId: 'BAG-RED',
            externalIds: [{ source: 'shopify', entity: 'variant', externalId: '99' }],
          },
        ],
      }),
    )
    expect(second?.id).toBe(first?.id)
    expect(second?.title).toBe('Red Bag Deluxe')
    expect(second?.handle).toBe('red-bag-v2')
    expect(second?.variants).toHaveLength(1)
    expect(second?.variants[0]?.title).toBe('Large')
  })

  it('does not overwrite a locked Shopify import on the next import', async () => {
    const db = createMemoryDb()
    const edited = await upsertProduct(
      db,
      draft({
        origin: 'shopify_import',
        locked: true,
        title: 'Merchant edited title',
      }),
    )
    const imported = await upsertProduct(
      db,
      draft({
        origin: 'shopify_import',
        locked: false,
        title: 'Shopify overwrite',
      }),
    )
    expect(imported?.id).toBe(edited?.id)
    expect(imported?.title).toBe('Merchant edited title')
    expect(imported?.locked).toBe(true)
  })

  it('does not overwrite a WACRM-owned product on Shopify import', async () => {
    const db = createMemoryDb()
    const owned = await upsertProduct(
      db,
      draft({
        origin: 'wacrm',
        title: 'Merchant Bag',
        externalIds: [],
      }),
    )
    const imported = await upsertProduct(
      db,
      draft({
        origin: 'shopify_import',
        title: 'Shopify Bag',
        externalIds: [{ source: 'shopify', entity: 'product', externalId: '99' }],
      }),
    )
    expect(imported?.id).toBe(owned?.id)
    expect(imported?.title).toBe('Merchant Bag')
    expect(imported?.origin).toBe('wacrm')
  })

  it('deletes a product for the same account only', async () => {
    const db = createMemoryDb()
    const product = await upsertProduct(db, draft())
    expect(await deleteProduct(db, 'acct-b', product!.id)).toBe(false)
    expect(await getProductById(db, 'acct-a', product!.id)).not.toBeNull()
    expect(await deleteProduct(db, 'acct-a', product!.id)).toBe(true)
    expect(await getProductById(db, 'acct-a', product!.id)).toBeNull()
  })

  it('scopes reads by account_id', async () => {
    const db = createMemoryDb()
    await upsertProduct(db, draft({ accountId: 'acct-a' }))
    await upsertProduct(
      db,
      draft({
        accountId: 'acct-b',
        handle: 'blue-bag',
        title: 'Blue Bag',
        variants: [{ title: 'Default', retailerId: 'BLUE', available: true }],
        externalIds: [{ source: 'shopify', entity: 'product', externalId: '77' }],
      }),
    )
    expect(await getProductByHandle(db, 'acct-a', 'red-bag')).not.toBeNull()
    expect(await getProductByHandle(db, 'acct-a', 'blue-bag')).toBeNull()
    expect(await getProductByRetailerId(db, 'acct-a', 'BLUE')).toBeNull()
    expect(await getProductByRetailerId(db, 'acct-b', 'BLUE')).not.toBeNull()
  })

  it('replaces stale Shopify imports without deleting WACRM products', async () => {
    const db = createMemoryDb()
    const keep = await upsertProduct(db, draft())
    await upsertProduct(
      db,
      draft({
        handle: 'old-bag',
        title: 'Old Bag',
        variants: [{ title: 'Default', retailerId: 'OLD', available: true }],
        externalIds: [{ source: 'shopify', entity: 'product', externalId: 'old-1' }],
      }),
    )
    const wacrm = await upsertProduct(
      db,
      draft({
        handle: 'handmade',
        title: 'Handmade',
        origin: 'wacrm',
        variants: [{ title: 'Default', retailerId: 'HAND', available: true }],
        externalIds: [],
      }),
    )

    await replaceImportedAccountProducts(db, 'acct-a', [
      draft({ title: 'Red Bag Updated' }),
    ])

    expect(await getProductById(db, 'acct-a', keep!.id)).not.toBeNull()
    expect(await getProductByHandle(db, 'acct-a', 'old-bag')).toBeNull()
    expect(await getProductById(db, 'acct-a', wacrm!.id)).not.toBeNull()
    expect((await getProductById(db, 'acct-a', keep!.id))?.title).toBe(
      'Red Bag Updated',
    )
  })

  it('emits an upsert after create and a delete before local product removal', async () => {
    const db = createMemoryDb()
    const product = await upsertProduct(db, draft())
    expect(enqueueCatalogProductUpsert).toHaveBeenCalledWith(
      db,
      'acct-a',
      product!.id,
      ['BAG-RED'],
    )
    expect(scheduleCatalogEmbed).toHaveBeenCalledWith(db, 'acct-a', product!.id)
    enqueueCatalogProductUpsert.mockClear()
    await deleteProduct(db, 'acct-a', product!.id)
    expect(enqueueCatalogProductDelete).toHaveBeenCalledWith(
      db,
      'acct-a',
      product!.id,
      ['BAG-RED'],
      { variantOnly: false },
    )
    expect(await getProductById(db, 'acct-a', product!.id)).toBeNull()
  })

  it('emits delete of previous retailer_ids when archived', async () => {
    const db = createMemoryDb()
    await upsertProduct(db, draft())
    enqueueCatalogProductUpsert.mockClear()
    enqueueCatalogProductDelete.mockClear()
    await upsertProduct(db, draft({ status: 'archived' }))
    expect(enqueueCatalogProductUpsert).not.toHaveBeenCalled()
    expect(enqueueCatalogProductDelete).toHaveBeenCalledWith(
      db,
      'acct-a',
      expect.any(String),
      ['BAG-RED'],
    )
  })

  it('emits a stale-variant delete alongside the product upsert', async () => {
    const db = createMemoryDb()
    await upsertProduct(db, draft())
    enqueueCatalogProductUpsert.mockClear()
    enqueueCatalogProductDelete.mockClear()
    await upsertProduct(
      db,
      draft({
        variants: [
          {
            title: 'Large',
            sku: 'BAG-XL',
            price: 59,
            available: true,
            retailerId: 'BAG-XL',
          },
        ],
      }),
    )
    expect(enqueueCatalogProductUpsert).toHaveBeenCalledWith(
      db,
      'acct-a',
      expect.any(String),
      ['BAG-XL'],
    )
    expect(enqueueCatalogProductDelete).toHaveBeenCalledWith(
      db,
      'acct-a',
      expect.any(String),
      ['BAG-RED'],
      { variantOnly: true },
    )
  })

  it('writes collection joins and media storage_path for a WACRM product', async () => {
    const db = createMemoryDb()
    await db.from('catalog_collections').insert({
      id: 'col-1',
      account_id: 'acct-a',
      handle: 'sarees',
      title: 'Sarees',
      status: 'active',
    })
    const product = await upsertProduct(
      db,
      draft({
        origin: 'wacrm',
        collectionIds: ['col-1'],
        media: [
          {
            url: 'https://cdn.example/owned.jpg',
            role: 'hero',
            sortOrder: 0,
            storagePath: 'account-acct-a/catalog/owned.jpg',
          },
        ],
      }),
    )
    expect(product?.media[0]?.storagePath).toBe('account-acct-a/catalog/owned.jpg')
    const { data: joins } = await db
      .from('catalog_product_collections')
      .select()
      .eq('product_id', product!.id)
    expect(joins).toEqual([
      expect.objectContaining({ collection_id: 'col-1', account_id: 'acct-a' }),
    ])
    expect(enqueueCatalogSetUpserts).toHaveBeenCalledWith(
      db,
      'acct-a',
      expect.arrayContaining(['col-1']),
    )
  })

  it('keeps the catalog write when outbox enqueue throws', async () => {
    enqueueCatalogProductUpsert.mockRejectedValueOnce(new Error('redis down'))
    const db = createMemoryDb()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const product = await upsertProduct(db, draft())
    expect(product?.title).toBe('Red Bag')
    expect(await getProductById(db, 'acct-a', product!.id)).not.toBeNull()
    expect(scheduleCatalogEmbed).toHaveBeenCalled()
    warn.mockRestore()
  })
})

function createMemoryDb(): SupabaseClient {
  const tables: Record<string, Record<string, unknown>[]> = {
    catalog_products: [],
    catalog_variants: [],
    catalog_media: [],
    catalog_external_ids: [],
    catalog_attributes: [],
    catalog_attribute_values: [],
    catalog_collections: [],
    catalog_product_collections: [],
  }
  let seq = 1
  const id = () => `id-${seq++}`
  const uniqueKeys: Record<string, string[]> = {
    catalog_products: ['account_id', 'handle'],
    catalog_collections: ['account_id', 'handle'],
    catalog_variants: ['account_id', 'retailer_id'],
    catalog_media: ['product_id', 'url'],
    catalog_external_ids: ['account_id', 'source', 'entity', 'external_id'],
    catalog_attributes: ['account_id', 'key'],
    catalog_product_collections: ['product_id', 'collection_id'],
  }

  const from = (table: string) => {
    const rows = () => tables[table] ?? []
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    const apply = () => rows().filter((row) => filters.every((fn) => fn(row)))
    const matchUnique = (row: Record<string, unknown>, incoming: Record<string, unknown>) =>
      (uniqueKeys[table] ?? []).every((key) => row[key] === incoming[key])

    const result = () => ({ data: apply(), error: null })
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      or: () => builder,
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) =>
        resolve(result()),
      insert: (incoming: Record<string, unknown>) => {
        if (rows().some((row) => matchUnique(row, incoming))) {
          const err = { data: null, error: { code: '23505', message: 'duplicate key' } }
          return {
            select: () => ({
              maybeSingle: async () => err,
            }),
            then: (resolve: (value: typeof err) => void) => resolve(err),
          }
        }
        const row = { id: id(), ...incoming }
        rows().push(row)
        const ok = { data: row, error: null }
        return {
          select: () => ({
            maybeSingle: async () => ok,
          }),
          then: (resolve: (value: typeof ok) => void) => resolve(ok),
        }
      },
      upsert: (incoming: Record<string, unknown>) => {
        const existing = rows().find((row) => matchUnique(row, incoming))
        const row = existing ?? { id: id(), ...incoming }
        if (existing) Object.assign(existing, incoming)
        else rows().push(row)
        const ok = { data: row, error: null }
        return {
          select: () => ({
            maybeSingle: async () => ok,
          }),
          then: (resolve: (value: typeof ok) => void) => resolve(ok),
        }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value)
          return {
            eq: (column2: string, value2: unknown) => {
              filters.push((row) => row[column2] === value2)
              for (const row of apply()) Object.assign(row, patch)
              return Promise.resolve({ error: null })
            },
            then: (
              resolve: (value: { error: null }) => void,
            ) => {
              for (const row of apply()) Object.assign(row, patch)
              resolve({ error: null })
            },
          }
        },
      }),
      delete: () => ({
        eq: (column: string, value: unknown) => {
          filters.push((row) => row[column] === value)
          const finish = () => {
            const keep = new Set(apply())
            tables[table] = rows().filter((row) => !keep.has(row))
            return { error: null }
          }
          return {
            eq: (column2: string, value2: unknown) => {
              filters.push((row) => row[column2] === value2)
              return {
                in: (column3: string, values: unknown[]) => {
                  filters.push((row) => values.includes(row[column3]))
                  return Promise.resolve(finish())
                },
                then: (resolve: (value: { error: null }) => void) => {
                  resolve(finish())
                },
              }
            },
            in: (column2: string, values: unknown[]) => {
              filters.push((row) => values.includes(row[column2]))
              return Promise.resolve(finish())
            },
          }
        },
      }),
    }
    return builder
  }

  return { from } as unknown as SupabaseClient
}
