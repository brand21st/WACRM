import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/094_sales_pattern_retrieval.sql'),
  'utf8'
)

describe('094_sales_pattern_retrieval.sql', () => {
  it('adds the off/shadow/on flag with default off and does not alter sales_patterns', () => {
    expect(sql).toContain('sales_pattern_retrieval')
    expect(sql).toContain("DEFAULT 'off'")
    expect(sql).toContain(
      "CHECK (sales_pattern_retrieval IN ('off', 'shadow', 'on'))"
    )
    expect(sql).not.toMatch(/ALTER TABLE sales_patterns/)
    expect(sql).not.toMatch(/ALTER TABLE sales_events/)
  })
})
