import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/082_catalog_sync_outbox_sets.sql'),
  'utf8',
)

describe('082_catalog_sync_outbox_sets.sql', () => {
  it('extends the existing outbox for collection set events', () => {
    expect(sql).toContain('ALTER TABLE catalog_sync_outbox')
    expect(sql).toContain('collection_id uuid')
    expect(sql).toContain('payload jsonb')
    expect(sql).toContain('set_upsert')
    expect(sql).toContain('set_delete')
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS catalog_sync_outbox_op_check')
    expect(sql).toContain('REFERENCES catalog_collections(id)')
    expect(sql).toContain('ON DELETE SET NULL')
    expect(sql).not.toContain('CREATE TABLE')
    expect(sql).not.toMatch(/ALTER TABLE catalog_products/)
  })
})
