import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/078_catalog_sales.sql'),
  'utf8',
)

describe('078_catalog_sales.sql', () => {
  it('adds the sales flag and account-scoped recommendation events', () => {
    expect(sql).toContain('catalog_sales_automation')
    expect(sql).toContain("CHECK (catalog_sales_automation IN ('off', 'shadow', 'on'))")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS catalog_recommendation_events')
    expect(sql).toContain("CHECK (event IN ('generated', 'shown'))")
    expect(sql).toContain('catalog_recommendation_events_account_created_idx')
    expect(sql).toContain('catalog_recommendation_events_conversation_created_idx')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('is_account_member(account_id)')
    expect(sql).toContain('No INSERT/UPDATE/DELETE policies')
    expect(sql).toContain('facts.shopping')
    expect(sql).not.toContain('vector(')
    expect(sql).not.toMatch(/ALTER TABLE catalog_products/)
    expect(sql).not.toMatch(/ALTER TABLE catalog_product_embeddings/)
    expect(sql).not.toMatch(/ALTER TABLE shopify_catalog_products/)
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS ai_knowledge_chunks/)
  })
})
