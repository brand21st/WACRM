import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260911041537_continuous_learning_controls.sql',
  ),
  'utf8',
)

describe('continuous learning controls migration', () => {
  it('is inert by default and exposes conservative controls', () => {
    expect(sql).toContain("background_learning_mode text NOT NULL DEFAULT 'off'")
    expect(sql).toContain(
      'background_learning_paused boolean NOT NULL DEFAULT false',
    )
    expect(sql).toContain("CHECK (background_learning_mode IN ('off', 'deterministic', 'hybrid'))")
  })

  it('persists analyzer state and marks pattern cursors transactionally', () => {
    expect(sql).toContain('pending_source_message_id')
    expect(sql).toContain('pending_trigger jsonb')
    expect(sql).toContain('sales_events_mark_pattern_dirty')
    expect(sql).toContain('AFTER INSERT ON sales_events')
    expect(sql).toContain('complete_pattern_discovery')
  })

  it('starts message work from the persisted message watermark, not now()', () => {
    expect(sql).toContain('SELECT m.created_at INTO v_pending_created_at')
    expect(sql).toContain(
      'v_pending_created_at, p_pending_trigger, \'running\', 1, now()',
    )
    expect(sql).not.toContain(
      "p_pending_message_id,\n    now(), p_pending_trigger, 'running'",
    )
  })

  it('clears an exact commerce trigger without erasing a newer message trigger', () => {
    expect(sql).toContain(
      'v_same_trigger := COALESCE(v_cursor.pending_trigger = p_completed_trigger, false)',
    )
    expect(sql).toContain(
      'v_keep_pending := NOT v_same_trigger OR v_newer_message',
    )
    expect(sql).not.toContain(
      'v_keep_pending := NOT v_same_trigger OR v_newer_message OR p_retry_llm',
    )
    expect(sql).toContain(
      'WHEN v_keep_pending THEN pending_source_message_id',
    )
  })

  it('stores separate deterministic and optional-LLM watermarks', () => {
    expect(sql).toContain('last_llm_source_message_id')
    expect(sql).toContain('last_llm_source_created_at')
    expect(sql).toContain(
      'SET last_llm_source_message_id = last_source_message_id',
    )
    expect(sql).toContain('WHEN p_advance_llm')
    expect(sql).toContain('WHEN p_retry_llm')
    expect(sql).toMatch(
      /jsonb_build_object\(\s*'type',\s*'message',\s*'messageId'/,
    )
  })

  it('restricts pending payloads and persisted errors to structured codes', () => {
    expect(sql).toContain(
      "pending_trigger - ARRAY['type', 'messageId', 'sourceId']::text[]",
    )
    expect(sql).toContain('conversation_analysis_cursors_error_code_check')
    expect(sql).toContain("'analysis_failed'")
    expect(sql).not.toMatch(
      /jsonb_build_object\([^)]*(content_text|transcript|prompt|phone|email)/i,
    )
  })

  it('exposes bounded preview and untruncated event aggregates', () => {
    expect(sql).toContain('preview_conversation_analysis_backfill')
    expect(sql).toContain('count_conversation_analysis_readiness')
    expect(sql).toContain('count_sales_events_by_type')
    expect(sql).toContain('start_conversation_analysis')
    expect(sql).toContain('complete_conversation_analysis')
    expect(sql).toContain('mark_conversation_analysis_trigger_pending')
    expect(sql).toContain('sales_events_account_created_idx')
    expect(sql).toContain('p_window_days integer DEFAULT 7')
    expect(sql).toContain('DROP FUNCTION IF EXISTS list_conversations_due_for_analysis(uuid, integer)')
  })

  it('keeps worker writes service-only with tenant RLS inherited', () => {
    expect(sql).toContain('TO service_role')
    expect(sql).toContain('FROM PUBLIC, anon, authenticated')
    expect(sql).not.toContain('FOR ALL TO authenticated')
  })

  it('deduplicates shadow diagnostics by tenant and opaque source turn', () => {
    expect(sql).toContain(
      'UNIQUE NULLS NOT DISTINCT (account_id, source_turn_id, pattern_id)',
    )
    expect(sql).toContain('SET source_turn_id = turn_id')
    expect(sql).not.toMatch(
      /sales_pattern_shadow_diagnostics[^;]*(content_text|transcript|prompt|phone|email)/i,
    )
  })
})
