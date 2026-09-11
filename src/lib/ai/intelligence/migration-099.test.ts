import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/099_sales_pattern_shadow_diagnostics.sql'),
  'utf8',
)

describe('099_sales_pattern_shadow_diagnostics.sql', () => {
  it('creates a PII-free shadow diagnostics table with tenant RLS', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sales_pattern_shadow_diagnostics')
    expect(sql).toContain('is_account_member(account_id)')
    expect(sql).toContain('FOR SELECT TO authenticated')
    expect(sql).not.toMatch(/content_text|phone|email|transcript|prompt/i)
    expect(sql).not.toMatch(/sales_pattern_retrieval/)
    expect(sql).not.toMatch(/ai_behavior_optimization/)
  })
})
