import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/095_sales_pattern_effectiveness.sql'),
  'utf8'
)

describe('095_sales_pattern_effectiveness.sql', () => {
  it('adds usage, eligibility, and the off/shadow/on flag without altering sales_events', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sales_pattern_usages')
    expect(sql).toContain('UNIQUE (account_id, pattern_id, conversation_id)')
    expect(sql).toContain('retrieval_eligible')
    expect(sql).toContain('sales_pattern_effectiveness')
    expect(sql).toContain("DEFAULT 'off'")
    expect(sql).toContain('pattern_effectiveness_cursors')
    expect(sql).not.toMatch(/ALTER TABLE sales_events/)
    expect(sql).not.toMatch(/ALTER TABLE ai_usage_log/)
  })
})
