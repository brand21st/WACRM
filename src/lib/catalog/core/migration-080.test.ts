import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/080_catalog_product_sets.sql'),
  'utf8',
)

describe('080_catalog_product_sets.sql', () => {
  it('adds a per-account Meta product set id on catalog_collections', () => {
    expect(sql).toContain('ALTER TABLE catalog_collections')
    expect(sql).toContain('meta_product_set_id')
    expect(sql).toContain('catalog_collections_account_meta_set_uidx')
    expect(sql).toContain('WHERE meta_product_set_id IS NOT NULL')
    expect(sql).not.toMatch(/ALTER TABLE catalog_products/)
    expect(sql).not.toMatch(/ALTER TABLE catalog_sync_outbox/)
    expect(sql).not.toContain('CREATE TABLE')
  })
})
