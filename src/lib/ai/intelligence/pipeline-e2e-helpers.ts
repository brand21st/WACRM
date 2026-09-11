/**
 * Test-only helpers for the sales-intelligence pipeline E2E harness.
 * Does not change Phase 3–7 production logic.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomInt, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
import { analyzeConversation } from '@/lib/ai/intelligence/analyze-conversation'
import { analyzeJobIdempotencyKey } from '@/lib/ai/intelligence/contracts'
import { setSalesPatternRetrievalMode } from '@/lib/ai/intelligence/ai-intelligence-admin'
import { setAiBehaviorOptimizationMode } from '@/lib/ai/intelligence/ai-behavior-admin'
import { loadAiBehaviorOptimizationMode } from '@/lib/ai/intelligence/assign-ai-behavior'
import { loadSalesPatternRetrievalMode } from '@/lib/ai/intelligence/retrieve-sales-patterns'
import { loadSalesPatternEffectivenessMode } from '@/lib/ai/intelligence/evaluate-pattern-effectiveness'
import { ALLOWED_METADATA_KEYS } from '@/lib/ai/intelligence/sales-event-types'
import type { SalesPatternEffectivenessMode } from '@/lib/ai/intelligence/pattern-effectiveness-types'

export const CONTACT_NAME_PREFIX = '[e2e-intel]'
export const COMMERCE_REF_PREFIX = 'e2e-intel-'
export const PRICE_OBJECTION_COPY =
  'This kurti is nice but too expensive. Do you have something cheaper around 3000?'

export function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq)
    let value = trimmed.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

export function envFlag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

export type TestConversation = {
  contactId: string
  conversationId: string
  messageId: string
  phone: string
}

export type SalesEventRow = {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string | null
  event_type: string
  kind: string
  metadata: Record<string, unknown> | null
}

export type PipelineReport = {
  phase3: {
    sales_event_created: 'YES' | 'NO'
    event_type: string
    account_isolated: 'YES' | 'NO'
  }
  phase4: {
    pattern_created: 'YES' | 'NO'
    pattern_type: string
    status: string
    evidence_count: number
  }
  phase5_shadow: {
    skipped: boolean
    retrieved: 'YES' | 'NO' | 'SKIPPED'
    match_score: number | null
    match_reasons: string[]
    injected: 'NO' | 'SKIPPED'
    usage_created: 'NO' | 'SKIPPED'
  }
  phase5_on: {
    skipped: boolean
    retrieved: 'YES' | 'NO' | 'SKIPPED'
    injected: 'YES' | 'NO' | 'SKIPPED'
    usage_created: 'YES' | 'NO' | 'SKIPPED'
  }
  phase6: {
    skipped: boolean
    usage_attributed: 'YES' | 'NO' | 'SKIPPED'
    outcome: string
    result: 'success' | 'failure' | 'unresolved' | 'SKIPPED'
    observed_success_rate: number | null
  }
  phase7: {
    optimization_flag: 'OFF' | 'ON'
    experiments: number
    assignments: number
  }
  flags_after: {
    sales_pattern_retrieval: string
    sales_pattern_effectiveness: string
    ai_behavior_optimization: string
  }
  conversations_used: number
  notes: string[]
}

export function emptyPipelineReport(): PipelineReport {
  return {
    phase3: {
      sales_event_created: 'NO',
      event_type: '',
      account_isolated: 'NO',
    },
    phase4: {
      pattern_created: 'NO',
      pattern_type: '',
      status: '',
      evidence_count: 0,
    },
    phase5_shadow: {
      skipped: true,
      retrieved: 'SKIPPED',
      match_score: null,
      match_reasons: [],
      injected: 'SKIPPED',
      usage_created: 'SKIPPED',
    },
    phase5_on: {
      skipped: true,
      retrieved: 'SKIPPED',
      injected: 'SKIPPED',
      usage_created: 'SKIPPED',
    },
    phase6: {
      skipped: true,
      usage_attributed: 'SKIPPED',
      outcome: '',
      result: 'SKIPPED',
      observed_success_rate: null,
    },
    phase7: {
      optimization_flag: 'OFF',
      experiments: 0,
      assignments: 0,
    },
    flags_after: {
      sales_pattern_retrieval: 'unknown',
      sales_pattern_effectiveness: 'unknown',
      ai_behavior_optimization: 'unknown',
    },
    conversations_used: 0,
    notes: [],
  }
}

export function formatPipelineReport(report: PipelineReport): string {
  const lines = [
    'PHASE 3',
    `sales_event_created: ${report.phase3.sales_event_created}`,
    `event_type: ${report.phase3.event_type || '(none)'}`,
    `account_isolated: ${report.phase3.account_isolated}`,
    '',
    'PHASE 4',
    `pattern_created: ${report.phase4.pattern_created}`,
    `pattern_type: ${report.phase4.pattern_type || '(none)'}`,
    `status: ${report.phase4.status || '(none)'}`,
    `evidence_count: ${report.phase4.evidence_count}`,
    '',
    'PHASE 5 SHADOW',
    report.phase5_shadow.skipped
      ? 'SKIPPED'
      : [
          `retrieved: ${report.phase5_shadow.retrieved}`,
          `match_score: ${report.phase5_shadow.match_score ?? '(none)'}`,
          `match_reasons: ${report.phase5_shadow.match_reasons.join(', ') || '(none)'}`,
          `injected: ${report.phase5_shadow.injected}`,
          `usage_created: ${report.phase5_shadow.usage_created}`,
        ].join('\n'),
    '',
    'PHASE 5 ON',
    report.phase5_on.skipped
      ? 'SKIPPED'
      : [
          `retrieved: ${report.phase5_on.retrieved}`,
          `injected: ${report.phase5_on.injected}`,
          `usage_created: ${report.phase5_on.usage_created}`,
        ].join('\n'),
    '',
    'PHASE 6',
    report.phase6.skipped
      ? 'SKIPPED'
      : [
          `usage_attributed: ${report.phase6.usage_attributed}`,
          `outcome: ${report.phase6.outcome || '(none)'}`,
          `success/failure/unresolved: ${report.phase6.result}`,
          `observed_success_rate: ${report.phase6.observed_success_rate ?? '(none)'}`,
        ].join('\n'),
    '',
    'PHASE 7',
    `optimization_flag: ${report.phase7.optimization_flag}`,
    `experiments: ${report.phase7.experiments}`,
    `assignments: ${report.phase7.assignments}`,
    '',
    'FLAGS AFTER TEST',
    `sales_pattern_retrieval = ${report.flags_after.sales_pattern_retrieval}`,
    `sales_pattern_effectiveness = ${report.flags_after.sales_pattern_effectiveness}`,
    `ai_behavior_optimization = ${report.flags_after.ai_behavior_optimization}`,
  ]
  if (report.notes.length) {
    lines.push('', 'NOTES', ...report.notes.map((note) => `- ${note}`))
  }
  return lines.join('\n')
}

export async function resolvePipelineAccount(
  db: SupabaseClient,
): Promise<string | null> {
  const accountId = process.env.E2E_INTELLIGENCE_ACCOUNT_ID?.trim()
  if (!accountId) return null
  const { data, error } = await db
    .from('accounts')
    .select('id')
    .eq('id', accountId)
    .maybeSingle()
  if (error || !data?.id) return null
  return data.id as string
}

export async function pollUntil<T>(
  fn: () => Promise<T | null | undefined>,
  opts: { timeoutMs?: number; intervalMs?: number; label: string },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  const intervalMs = opts.intervalMs ?? 1_000
  const started = Date.now()
  let lastError: unknown
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn()
      if (value != null) return value
    } catch (err) {
      lastError = err
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs))
  }
  const extra = lastError instanceof Error ? ` (${lastError.message})` : ''
  throw new Error(`timed out waiting for ${opts.label} after ${timeoutMs}ms${extra}`)
}

export function assertSafeEventMetadata(metadata: unknown) {
  const raw = metadata && typeof metadata === 'object' ? metadata : {}
  const keys = Object.keys(raw as Record<string, unknown>)
  for (const key of keys) {
    if (!(ALLOWED_METADATA_KEYS as readonly string[]).includes(key)) {
      throw new Error(`sales_event metadata leaked key: ${key}`)
    }
  }
  const blob = JSON.stringify(raw)
  if (/phone|email|transcript|kurti is nice/i.test(blob)) {
    throw new Error('sales_event metadata contains PII or transcript text')
  }
}

export async function insertTestConversation(
  db: SupabaseClient,
  args: {
    accountId: string
    ownerUserId: string
    runId: string
    index: number
    text?: string
  },
): Promise<TestConversation> {
  const phone = `+1555010${String(randomInt(0, 10_000)).padStart(4, '0')}`
  const name = `${CONTACT_NAME_PREFIX} ${args.runId} ${args.index}`
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .insert({
      account_id: args.accountId,
      user_id: args.ownerUserId,
      phone,
      name,
    })
    .select('id')
    .single()
  if (contactErr || !contact?.id) {
    throw new Error(
      `failed to insert test contact: ${contactErr?.message ?? 'no id'}`,
    )
  }

  const { data: conversation, error: convErr } = await db
    .from('conversations')
    .insert({
      account_id: args.accountId,
      user_id: args.ownerUserId,
      contact_id: contact.id,
    })
    .select('id')
    .single()
  if (convErr || !conversation?.id) {
    throw new Error(
      `failed to insert test conversation: ${convErr?.message ?? 'no id'}`,
    )
  }

  const { data: message, error: msgErr } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: 'text',
      content_text: args.text ?? PRICE_OBJECTION_COPY,
      status: 'delivered',
      message_id: `e2e-intel-${args.runId}-${args.index}`,
    })
    .select('id')
    .single()
  if (msgErr || !message?.id) {
    throw new Error(
      `failed to insert test message: ${msgErr?.message ?? 'no id'}`,
    )
  }

  return {
    contactId: contact.id as string,
    conversationId: conversation.id as string,
    messageId: message.id as string,
    phone,
  }
}

export async function analyzeTestConversation(
  db: SupabaseClient,
  args: {
    accountId: string
    conversation: TestConversation
  },
) {
  const job = {
    accountId: args.accountId,
    conversationId: args.conversation.conversationId,
    contactId: args.conversation.contactId,
    trigger: { type: 'message' as const, messageId: args.conversation.messageId },
    runId: randomUUID(),
    idempotencyKey: analyzeJobIdempotencyKey({
      accountId: args.accountId,
      conversationId: args.conversation.conversationId,
      trigger: { type: 'message', messageId: args.conversation.messageId },
    }),
  }
  return analyzeConversation(db, job, {
    extractLlm: async () => ({ events: [], usage: null, status: 'success' }),
    loadControls: async () => ({
      mode: 'deterministic',
      paused: false,
      dailyConversationLimit: 100,
      dailyTokenLimit: 25000,
    }),
  })
}

export async function waitForSalesEvent(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    eventType?: string
  },
): Promise<SalesEventRow> {
  return pollUntil(
    async () => {
      let query = db
        .from('sales_events')
        .select(
          'id, account_id, conversation_id, contact_id, event_type, kind, metadata',
        )
        .eq('account_id', args.accountId)
        .eq('conversation_id', args.conversationId)
      if (args.eventType) query = query.eq('event_type', args.eventType)
      const { data, error } = await query.limit(1).maybeSingle()
      if (error) throw error
      return (data as SalesEventRow | null) ?? null
    },
    { label: `sales_event ${args.eventType ?? 'any'} for ${args.conversationId}` },
  )
}

export async function insertCommerceOrder(
  db: SupabaseClient,
  args: {
    accountId: string
    conversation: TestConversation
    runId: string
    index: number
  },
): Promise<string> {
  const referenceId = `${COMMERCE_REF_PREFIX}${args.runId}-${args.index}`
  const { error } = await db.from('whatsapp_commerce_orders').insert({
    account_id: args.accountId,
    contact_id: args.conversation.contactId,
    conversation_id: args.conversation.conversationId,
    reference_id: referenceId,
    status: 'processing',
    currency: 'INR',
    total_value: 3000,
    line_items: [],
  })
  if (error) {
    throw new Error(`failed to insert commerce order: ${error.message}`)
  }
  return referenceId
}

export async function setSalesPatternEffectivenessModeForTest(
  db: SupabaseClient,
  accountId: string,
  mode: SalesPatternEffectivenessMode,
): Promise<SalesPatternEffectivenessMode> {
  const next = mode === 'shadow' || mode === 'on' ? mode : 'off'
  const { error } = await db
    .from('ai_configs')
    .update({ sales_pattern_effectiveness: next })
    .eq('account_id', accountId)
  if (error) throw error
  return next
}

export async function restoreIntelligenceFlags(
  db: SupabaseClient,
  accountId: string,
) {
  await setSalesPatternRetrievalMode(db, accountId, 'off')
  await setSalesPatternEffectivenessModeForTest(db, accountId, 'off')
  await setAiBehaviorOptimizationMode(db, accountId, 'off')
}

export async function readIntelligenceFlags(
  db: SupabaseClient,
  accountId: string,
) {
  const [retrieval, effectiveness, optimization] = await Promise.all([
    loadSalesPatternRetrievalMode(db, accountId),
    loadSalesPatternEffectivenessMode(db, accountId),
    loadAiBehaviorOptimizationMode(db, accountId),
  ])
  return {
    sales_pattern_retrieval: retrieval,
    sales_pattern_effectiveness: effectiveness,
    ai_behavior_optimization: optimization,
  }
}

export async function countPhase7Rows(
  db: SupabaseClient,
  accountId: string,
) {
  const [experiments, assignments] = await Promise.all([
    db
      .from('ai_behavior_experiments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
    db
      .from('ai_behavior_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId),
  ])
  return {
    experiments: experiments.count ?? 0,
    assignments: assignments.count ?? 0,
  }
}

export async function resolveOwnerUserId(
  db: SupabaseClient,
  accountId: string,
): Promise<string> {
  return resolveAuditUserId(db, accountId)
}

export async function cleanupTestRecords(
  db: SupabaseClient,
  accountId: string,
) {
  await db
    .from('whatsapp_commerce_orders')
    .delete()
    .eq('account_id', accountId)
    .like('reference_id', `${COMMERCE_REF_PREFIX}%`)

  const { data: contacts, error } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .like('name', `${CONTACT_NAME_PREFIX}%`)
  if (error) throw error
  const ids = (contacts ?? []).map((row) => row.id as string)
  if (!ids.length) return { contacts: 0 }
  const { error: deleteErr } = await db
    .from('contacts')
    .delete()
    .eq('account_id', accountId)
    .in('id', ids)
  if (deleteErr) throw deleteErr
  return { contacts: ids.length }
}

export async function loadPriceObjectionPattern(
  db: SupabaseClient,
  accountId: string,
) {
  const { data, error } = await db
    .from('sales_patterns')
    .select(
      'id, account_id, pattern_type, status, sample_count, eligible_outcome_count, retrieval_eligible, effectiveness',
    )
    .eq('account_id', accountId)
    .eq('pattern_type', 'PRICE_OBJECTION')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as {
    id: string
    account_id: string
    pattern_type: string
    status: string
    sample_count: number
    eligible_outcome_count: number
    retrieval_eligible: boolean | null
    effectiveness: unknown
  } | null
}

export async function countUsages(
  db: SupabaseClient,
  args: { accountId: string; conversationId?: string; patternId?: string },
) {
  let query = db
    .from('sales_pattern_usages')
    .select('id, attribution_status, attributed_event_type, pattern_id', {
      count: 'exact',
    })
    .eq('account_id', args.accountId)
  if (args.conversationId) query = query.eq('conversation_id', args.conversationId)
  if (args.patternId) query = query.eq('pattern_id', args.patternId)
  const { data, count, error } = await query
  if (error) throw error
  return { rows: data ?? [], count: count ?? 0 }
}
