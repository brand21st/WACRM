import { describe, expect, it } from 'vitest'
import { assertCatalogImportCoverage } from './consistency'
import { createCatalogMemoryDb } from './memory-db'

describe('assertCatalogImportCoverage', () => {
  it('reports a gap when the Shopify snapshot is ahead of WACRM imports', async () => {
    const db = createCatalogMemoryDb({
      shopify_catalog_products: [
        { id: 's1', account_id: 'acct-a' },
        { id: 's2', account_id: 'acct-a' },
      ],
      catalog_products: [
        {
          id: 'p1',
          account_id: 'acct-a',
          origin: 'shopify_import',
        },
        {
          id: 'p2',
          account_id: 'acct-a',
          origin: 'wacrm',
        },
      ],
    })
    const coverage = await assertCatalogImportCoverage(db, 'acct-a')
    expect(coverage.snapshotCount).toBe(2)
    expect(coverage.importedCount).toBe(1)
    expect(coverage.gap).toBe(1)
  })
})
