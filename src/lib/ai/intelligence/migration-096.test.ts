import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/096_ai_behavior_optimization.sql'),
  'utf8'
)

describe('096_ai_behavior_optimization.sql', () => {
  it('adds versions, experiments, assignments, and an off/on flag', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_behavior_versions')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_behavior_experiments')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS ai_behavior_assignments')
    expect(sql).toContain('UNIQUE (account_id, experiment_id, conversation_id)')
    expect(sql).toContain('ai_behavior_optimization')
    expect(sql).toContain("DEFAULT 'off'")
    expect(sql).toContain("CHECK (ai_behavior_optimization IN ('off', 'on'))")
    expect(sql).toContain('control_was_implicit')
    expect(sql).toContain("status IN ('running', 'evaluating')")
    expect(sql).not.toMatch(/ALTER TABLE sales_events/)
    expect(sql).not.toMatch(/ALTER TABLE sales_patterns/)
    expect(sql).not.toMatch(/ALTER TABLE ai_usage_log/)
    expect(sql).not.toMatch(/shadow/)
    expect(sql).toContain("to_regclass('public.sales_events')")
  })
})
