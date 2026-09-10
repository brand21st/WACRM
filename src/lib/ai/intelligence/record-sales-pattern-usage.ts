/**
 * Phase 6 usage writer. Records injected patterns only.
 * Callers own the "was this injected into the LLM prompt?" policy.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAccountId } from './contracts'
import type { RetrievedSalesPattern } from './retrieve-sales-patterns'

export type RecordSalesPatternUsageArgs = {
  accountId: string
  conversationId: string
  matches: RetrievedSalesPattern[]
  sourceMessageId?: string | null
  usedAt?: string
}

export type RecordSalesPatternUsageDeps = {
  upsertUsages?: (
    db: SupabaseClient,
    rows: SalesPatternUsageInsert[]
  ) => Promise<number>
}

export type SalesPatternUsageInsert = {
  account_id: string
  pattern_id: string
  conversation_id: string
  source_message_id: string | null
  used_at: string
  attribution_status: 'unresolved'
}

/**
 * Upsert one usage row per pattern in this conversation.
 * Repeat injections do not bump used_at (ignoreDuplicates).
 * Never throws — live replies must not depend on this write.
 */
export async function recordSalesPatternUsage(
  db: SupabaseClient,
  args: RecordSalesPatternUsageArgs,
  deps: RecordSalesPatternUsageDeps = {}
): Promise<number> {
  try {
    const accountId = requireAccountId(args.accountId, 'recordSalesPatternUsage')
    const conversationId = args.conversationId.trim()
    if (!conversationId || args.matches.length === 0) return 0

    const usedAt = args.usedAt ?? new Date().toISOString()
    const seen = new Set<string>()
    const rows: SalesPatternUsageInsert[] = []
    for (const match of args.matches) {
      const patternId = match.patternId?.trim()
      if (!patternId || seen.has(patternId)) continue
      seen.add(patternId)
      rows.push({
        account_id: accountId,
        pattern_id: patternId,
        conversation_id: conversationId,
        source_message_id: args.sourceMessageId?.trim() || null,
        used_at: usedAt,
        attribution_status: 'unresolved',
      })
    }
    if (!rows.length) return 0

    const upsert = deps.upsertUsages ?? defaultUpsertUsages
    return await upsert(db, rows)
  } catch (err) {
    console.warn('[sales-pattern-usage] record failed', {
      accountId: args.accountId,
    })
    void err
    return 0
  }
}

async function defaultUpsertUsages(
  db: SupabaseClient,
  rows: SalesPatternUsageInsert[]
): Promise<number> {
  const { error } = await db.from('sales_pattern_usages').upsert(rows, {
    onConflict: 'account_id,pattern_id,conversation_id',
    ignoreDuplicates: true,
  })
  if (error) throw error
  return rows.length
}
