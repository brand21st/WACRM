import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/077_catalog_embeddings.sql'),
  'utf8',
)

describe('077_catalog_embeddings.sql', () => {
  it('adds product vectors, hybrid flag, and an account-scoped INVOKER RPC', () => {
    expect(sql).toContain('catalog_hybrid_search')
    expect(sql).toContain("CHECK (catalog_hybrid_search IN ('off', 'shadow', 'on'))")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS catalog_product_embeddings')
    expect(sql).toContain('vector(1536)')
    expect(sql).toContain('USING hnsw (embedding vector_cosine_ops)')
    expect(sql).toContain('ON DELETE CASCADE')
    expect(sql).toContain('match_catalog_products_semantic')
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).not.toContain('SECURITY DEFINER')
    expect(sql).toContain('e.account_id = p_account_id')
    expect(sql).toContain("e.status IN ('ready', 'stale')")
    expect(sql).toContain('e.dimensions = 1536')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.match_catalog_products_semantic')
    expect(sql).not.toMatch(/ALTER TABLE shopify_catalog_products/)
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS ai_knowledge_chunks/)
    expect(sql).not.toMatch(/ALTER TABLE ai_knowledge_chunks/)
  })
})
