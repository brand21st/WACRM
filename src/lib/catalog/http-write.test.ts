import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from './search/memory-db'
import {
  CatalogWriteError,
  buildCatalogWriteDraft,
  isAccountCatalogStoragePath,
  makeWacrmRetailerId,
  slugifyCatalogHandle,
} from './http-write'

describe('catalog write helpers', () => {
  it('slugifies handles and builds stable WACRM retailer ids', () => {
    expect(slugifyCatalogHandle('Black Wedding Saree')).toBe('black-wedding-saree')
    expect(makeWacrmRetailerId('kurti', 0, 'KURTI-RED-S')).toBe('KURTI-RED-S')
    expect(makeWacrmRetailerId('kurti', 1)).toBe('wacrm_kurti_1')
    expect(isAccountCatalogStoragePath('acct-a', 'account-acct-a/catalog/1.jpg')).toBe(true)
    expect(isAccountCatalogStoragePath('acct-a', 'account-acct-b/catalog/1.jpg')).toBe(false)
  })

  it('builds a WACRM draft and rejects another account storage path', async () => {
    const db = createCatalogMemoryDb()
    const draft = await buildCatalogWriteDraft(db, {
      accountId: 'acct-a',
      origin: 'wacrm',
      locked: false,
      input: {
        title: 'Kurti',
        status: 'active',
        currency: 'INR',
        variants: [
          { title: 'Red / S', sku: 'K-RED-S', price: 499, options: [{ name: 'Color', value: 'Red' }] },
        ],
        media: [{ url: 'https://cdn.example/k.jpg', storagePath: 'account-acct-a/catalog/k.jpg' }],
      },
    })
    expect(draft.origin).toBe('wacrm')
    expect(draft.handle).toBe('kurti')
    expect(draft.variants[0]?.retailerId).toBe('K-RED-S')
    expect(draft.priceMin).toBe(499)

    await expect(
      buildCatalogWriteDraft(db, {
        accountId: 'acct-a',
        origin: 'wacrm',
        locked: false,
        input: {
          title: 'Kurti',
          media: [{ url: 'https://cdn.example/x.jpg', storagePath: 'account-other/catalog/x.jpg' }],
        },
      }),
    ).rejects.toBeInstanceOf(CatalogWriteError)
  })
})
