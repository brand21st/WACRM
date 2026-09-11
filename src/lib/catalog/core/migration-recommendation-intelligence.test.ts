import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260911041539_recommendation_intelligence.sql'
  ),
  'utf8'
)

describe('recommendation intelligence migration', () => {
  it('adds account-scoped evidence, aggregates, cursors, and grants', () => {
    expect(sql).toContain(
      "CHECK (recommendation_intelligence IN ('off', 'shadow'))"
    )
    expect(sql).toContain('recommendation_set_id')
    expect(sql).toContain('source_message_id')
    expect(sql).toContain('source_turn_id')
    expect(sql).toContain('baseline_rank')
    expect(sql).toContain('shadow_rank')
    expect(sql).toContain("'selected'")
    expect(sql).toContain("'rejected'")
    expect(sql).toContain("'unresolved'")
    expect(sql).toContain('catalog_product_events_account_idempotency_uidx')
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS catalog_recommendation_stats'
    )
    expect(sql).toContain(
      'PRIMARY KEY (account_id, product_id, mode, algorithm_version)'
    )
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS recommendation_intelligence_cursors'
    )
    expect(sql).toContain('pending_recommendation_event_created_at')
    expect(sql).toContain('pending_product_event_created_at')
    expect(sql).toContain(
      "CHECK (status IN ('pending', 'running', 'succeeded', 'failed'))"
    )
    expect(sql).toContain(
      'catalog_recommendation_events_mark_intelligence_dirty'
    )
    expect(sql).toContain(
      'catalog_product_events_mark_recommendation_intelligence_dirty'
    )
    expect(sql).toContain('list_due_recommendation_intelligence')
    expect(sql).toContain('claim_recommendation_intelligence')
    expect(sql).toContain('complete_recommendation_intelligence')
    expect(sql).toContain('fail_recommendation_intelligence')
    expect(sql).toContain('replace_catalog_recommendation_stats')
    expect(sql).toMatch(/THEN 'succeeded'\r?\n\s+ELSE 'pending'/)
    expect(sql).toContain(
      'cursor_row.pending_recommendation_event_id IS NOT DISTINCT FROM p_recommendation_id'
    )
    expect(sql).toContain(
      'REVOKE EXECUTE ON FUNCTION list_due_recommendation_intelligence(integer)'
    )
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('is_account_member(account_id)')
    expect(sql).toContain('TO service_role')
    expect(sql).toContain('not causal effect estimates')
    expect(sql).toContain(
      'catalog_recommendation_stats_account_last_observed_idx'
    )
    expect(sql).not.toContain('recommendation_shadow_diagnostics')
  })
})
