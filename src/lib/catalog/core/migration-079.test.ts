import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/079_catalog_management.sql'),
  'utf8',
)

describe('079_catalog_management.sql', () => {
  it('adds the analytics flag, events table, and media storage_path', () => {
    expect(sql).toContain('catalog_analytics')
    expect(sql).toContain("CHECK (catalog_analytics IN ('off', 'on'))")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS catalog_product_events')
    expect(sql).toContain(
      "CHECK (event IN ('search_match', 'shown', 'add_to_cart', 'purchase'))",
    )
    expect(sql).toContain('catalog_product_events_account_event_created_idx')
    expect(sql).toContain('catalog_product_events_account_product_event_created_idx')
    expect(sql).toContain('catalog_product_events_account_conversation_created_idx')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('is_account_member(account_id)')
    expect(sql).toContain('No INSERT/UPDATE/DELETE policies')
    expect(sql).toContain('ALTER TABLE catalog_media')
    expect(sql).toContain('storage_path')
    expect(sql).not.toMatch(/ALTER TABLE catalog_products/)
    expect(sql).not.toMatch(/ALTER TABLE catalog_sync_outbox/)
    expect(sql).not.toMatch(/ALTER TABLE catalog_recommendation_events/)
    expect(sql).not.toMatch(/ALTER TABLE shopify_catalog_products/)
    expect(sql).not.toContain('vector(')
  })
})
