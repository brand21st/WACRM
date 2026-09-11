import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/097_assignments_sales_event_fk.sql'),
  'utf8',
)

describe('097_assignments_sales_event_fk.sql', () => {
  it('only adds the deferred 096 sales_events FK', () => {
    expect(sql).toContain("to_regclass('public.sales_events')")
    expect(sql).toContain('ai_behavior_assignments_attributed_event_id_fkey')
    expect(sql).toContain('REFERENCES sales_events(id)')
    expect(sql).not.toMatch(/ALTER TABLE sales_events/)
    expect(sql).not.toMatch(/ai_behavior_optimization/)
  })
})
