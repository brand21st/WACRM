import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/075_catalog.sql'),
  'utf8',
)

describe('075_catalog.sql', () => {
  it('creates the first-party catalog tables', () => {
    for (const table of [
      'catalog_products',
      'catalog_variants',
      'catalog_media',
      'catalog_collections',
      'catalog_product_collections',
      'catalog_attributes',
      'catalog_attribute_values',
      'catalog_product_relations',
      'catalog_external_ids',
      'catalog_sync_outbox',
      'catalog_sync_state',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  it('does not alter shopify_catalog_products or add embeddings', () => {
    expect(sql).not.toMatch(/ALTER TABLE shopify_catalog_products/)
    expect(sql).not.toContain('catalog_product_embeddings')
    expect(sql).not.toMatch(/vector\(\d+\)/)
  })

  it('documents the RLS policy matrix and retailer_id helper', () => {
    expect(sql).toContain("t || '_select'")
    expect(sql).toContain("t || '_insert'")
    expect(sql).toContain("t || '_update'")
    expect(sql).toContain("t || '_delete'")
    expect(sql).toContain('is_account_member(account_id)')
    expect(sql).toContain("is_account_member(account_id, ''admin'')")
    expect(sql).toContain('catalog_retailer_id_for_variant')
    expect(sql).toContain('backfill_catalog_from_shopify_snapshot')
    expect(sql).toContain("origin = 'shopify_import'")
    expect(sql).toContain("origin = 'wacrm'")
    expect(sql).toContain(
      'WHERE catalog_attribute_values.variant_id = variant_uuid',
    )
  })
})
