import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/085_conversation_follow_up.sql'),
  'utf8',
)

describe('085_conversation_follow_up.sql', () => {
  it('adds follow-up delay on ai_configs and the follow-up table', () => {
    expect(sql).toContain('follow_up_enabled')
    expect(sql).toContain('follow_up_delay_minutes')
    expect(sql).toContain('BETWEEN 1 AND 1440')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversation_follow_ups')
    expect(sql).toContain("status IN ('pending', 'sending', 'sent', 'cancelled', 'skipped')")
    expect(sql).toContain('conversation_follow_ups_one_pending')
    expect(sql).toContain('conversation_follow_ups_one_sent_per_trigger')
    expect(sql).toContain("is_account_member(account_id, 'agent')")
  })
})

describe('086_conversation_follow_up_rls.sql', () => {
  it('lets agents cancel pending follow-ups', () => {
    const rls = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/086_conversation_follow_up_rls.sql'),
      'utf8',
    )
    expect(rls).toContain("is_account_member(account_id, 'agent')")
    expect(rls).not.toContain("is_account_member(account_id, 'admin')")
  })
})
