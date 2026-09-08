import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/076_catalog_sync_outbox.sql'),
  'utf8',
)

describe('076_catalog_sync_outbox.sql', () => {
  it('upgrades the Phase 1 outbox without touching Shopify or embeddings', () => {
    expect(sql).toContain('ON DELETE SET NULL')
    expect(sql).toContain('retailer_ids text[]')
    expect(sql).toContain('coalesce_key')
    expect(sql).toContain('claimed_at')
    expect(sql).toContain('catalog_sync_outbox_pending_coalesce_idx')
    expect(sql).toContain("status = 'pending'")
    expect(sql).not.toMatch(/ALTER TABLE shopify_catalog_products/)
    expect(sql).not.toMatch(/vector\(\d+\)/)
    expect(sql).not.toContain('catalog_product_embeddings')
  })
})
