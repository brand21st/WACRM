import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/081_meta_catalog_ids.sql'),
  'utf8',
)

describe('081_meta_catalog_ids.sql', () => {
  it('adds selected Meta catalog IDs on shopify_configs', () => {
    expect(sql).toContain('ALTER TABLE shopify_configs')
    expect(sql).toContain('meta_catalog_ids text[]')
    expect(sql).toContain("NOT NULL DEFAULT '{}'")
    expect(sql).toContain('ARRAY[meta_catalog_id]')
    expect(sql).not.toMatch(/ALTER TABLE catalog_products/)
    expect(sql).not.toContain('CREATE TABLE')
  })
})
