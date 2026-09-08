import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/084_catalog_collection_review.sql'),
  'utf8',
)

describe('084_catalog_collection_review.sql', () => {
  it('adds WhatsApp collection review status on catalog_collections', () => {
    expect(sql).toContain('ALTER TABLE catalog_collections')
    expect(sql).toContain('meta_collection_review')
    expect(sql).toContain('pending')
    expect(sql).toContain('live')
    expect(sql).not.toMatch(/ALTER TABLE catalog_products/)
    expect(sql).not.toContain('CREATE TABLE')
  })
})
