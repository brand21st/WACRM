/**
 * Phase 6 effectiveness recompute.
 * Observational association only — does not claim causation.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNTS_PER_CRON } from './sales-pattern-types'
import { requireAccountId } from './contracts'
import {
  EFFECTIVENESS_ANALYZER_VERSION,
  MAX_USAGES_PER_ACCOUNT,
  attributionFromEventType,
  attributionWindowEnd,
  effectivenessIdempotencyKey,
  isTerminalOutcomeType,
  nextRetrievalEligible,
  observedSuccessRate,
  type AttributionStatus,
  type PatternEffectiveness,
  type SalesPatternEffectivenessMode,
} from './pattern-effectiveness-types'

export type SalesPatternUsageRow = {
  id: string
  account_id: string
  pattern_id: string
  conversation_id: string
  used_at: string
  attribution_status: AttributionStatus
  attributed_event_id: string | null
  attributed_event_type: string | null
}

export type TerminalSalesEventRow = {
  id: string
  account_id: string
  conversation_id: string
  event_type: string
  kind: string
  created_at: string
}

export type PatternEligibilityRow = {
  id: string
  account_id: string
  retrieval_eligible: boolean
}

export type UsageAttribution = {
  id: string
  attribution_status: AttributionStatus
  attributed_event_id: string | null
  attributed_event_type: string | null
}

export type EffectivenessJob = {
  accountId: string
  idempotencyKey: string
}

export type EvaluatePatternEffectivenessDeps = {
  loadMode?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<SalesPatternEffectivenessMode>
  loadUsages?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<SalesPatternUsageRow[]>
  loadTerminalEvents?: (
    db: SupabaseClient,
    accountId: string,
    conversationIds: string[]
  ) => Promise<TerminalSalesEventRow[]>
  loadEligibility?: (
    db: SupabaseClient,
    accountId: string,
    patternIds: string[]
  ) => Promise<PatternEligibilityRow[]>
  writeAttributions?: (
    db: SupabaseClient,
    accountId: string,
    rows: UsageAttribution[]
  ) => Promise<void>
  writeEffectiveness?: (
    db: SupabaseClient,
    accountId: string,
    updates: PatternEffectivenessUpdate[]
  ) => Promise<void>
  upsertCursor?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<void>
  log?: (payload: Record<string, unknown>) => void
}

export type PatternEffectivenessUpdate = {
  patternId: string
  effectiveness: PatternEffectiveness
  retrievalEligible: boolean
  writeEligibility: boolean
}

export type EvaluatePatternEffectivenessResult = {
  accountId: string
  usageCount: number
  patternCount: number
  mode: SalesPatternEffectivenessMode
  skipped?: boolean
}

export async function loadSalesPatternEffectivenessMode(
  db: SupabaseClient,
  accountId: string
): Promise<SalesPatternEffectivenessMode> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select('sales_pattern_effectiveness')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !data) return 'off'
    const mode = (data as { sales_pattern_effectiveness?: string })
      .sales_pattern_effectiveness
    if (mode === 'shadow' || mode === 'on') return mode
    return 'off'
  } catch {
    return 'off'
  }
}

export function attributeUsage(
  usage: SalesPatternUsageRow,
  events: TerminalSalesEventRow[]
): UsageAttribution {
  const usedAt = Date.parse(usage.used_at)
  if (!Number.isFinite(usedAt)) {
    return unresolved(usage.id)
  }
  const windowEnd = attributionWindowEnd(usage.used_at).getTime()
  const later = events.filter((event) => {
    if (event.account_id !== usage.account_id) return false
    if (event.conversation_id !== usage.conversation_id) return false
    if (event.kind !== 'outcome') return false
    if (!isTerminalOutcomeType(event.event_type)) return false
    const created = Date.parse(event.created_at)
    if (!Number.isFinite(created)) return false
    return created > usedAt && created <= windowEnd
  })
  later.sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
  )
  const latest = later[0]
  if (!latest) return unresolved(usage.id)
  return {
    id: usage.id,
    attribution_status: attributionFromEventType(latest.event_type),
    attributed_event_id: latest.id,
    attributed_event_type: latest.event_type,
  }
}

export function rollupEffectiveness(
  usages: Array<Pick<SalesPatternUsageRow, 'pattern_id' | 'used_at'> & UsageAttribution>
): Map<string, PatternEffectiveness> {
  const byPattern = new Map<string, PatternEffectiveness>()
  for (const row of usages) {
    const current = byPattern.get(row.pattern_id) ?? emptyEffectiveness()
    current.usageCount += 1
    if (row.attribution_status === 'success') {
      current.successCount += 1
      current.eligibleUsageCount += 1
    } else if (row.attribution_status === 'failure') {
      current.failureCount += 1
      current.eligibleUsageCount += 1
    } else {
      current.unresolvedCount += 1
    }
    if (!current.firstUsedAt || row.used_at < current.firstUsedAt) {
      current.firstUsedAt = row.used_at
    }
    if (!current.lastUsedAt || row.used_at > current.lastUsedAt) {
      current.lastUsedAt = row.used_at
    }
    current.observedSuccessRate = observedSuccessRate(
      current.successCount,
      current.failureCount
    )
    byPattern.set(row.pattern_id, current)
  }
  return byPattern
}

export async function evaluateAccountPatternEffectiveness(
  db: SupabaseClient,
  accountId: string,
  deps: EvaluatePatternEffectivenessDeps = {}
): Promise<EvaluatePatternEffectivenessResult> {
  const id = requireAccountId(accountId, 'evaluateAccountPatternEffectiveness')
  const loadMode = deps.loadMode ?? loadSalesPatternEffectivenessMode
  const mode = await loadMode(db, id)

  const loadUsages = deps.loadUsages ?? loadAccountUsages
  const usages = (await loadUsages(db, id)).filter(
    (row) => row.account_id === id
  )
  if (!usages.length) {
    await (deps.upsertCursor ?? upsertEffectivenessCursor)(db, id)
    return { accountId: id, usageCount: 0, patternCount: 0, mode, skipped: true }
  }

  const conversationIds = [...new Set(usages.map((row) => row.conversation_id))]
  const loadEvents = deps.loadTerminalEvents ?? loadAccountTerminalEvents
  const events = (await loadEvents(db, id, conversationIds)).filter(
    (row) => row.account_id === id
  )

  const attributions = usages.map((usage) => ({
    ...usage,
    ...attributeUsage(usage, events),
  }))

  const writeAttributions = deps.writeAttributions ?? persistAttributions
  await writeAttributions(
    db,
    id,
    attributions.map((row) => ({
      id: row.id,
      attribution_status: row.attribution_status,
      attributed_event_id: row.attributed_event_id,
      attributed_event_type: row.attributed_event_type,
    }))
  )

  const rolled = rollupEffectiveness(attributions)
  const patternIds = [...rolled.keys()]
  const loadEligibility = deps.loadEligibility ?? loadPatternEligibility
  const currentEligible = new Map(
    (await loadEligibility(db, id, patternIds))
      .filter((row) => row.account_id === id)
      .map((row) => [row.id, row.retrieval_eligible !== false])
  )

  const writeEligibility = mode === 'on'
  const updates: PatternEffectivenessUpdate[] = patternIds.map((patternId) => {
    const effectiveness = rolled.get(patternId) ?? emptyEffectiveness()
    return {
      patternId,
      effectiveness,
      retrievalEligible: nextRetrievalEligible({
        eligibleUsageCount: effectiveness.eligibleUsageCount,
        observedSuccessRate: effectiveness.observedSuccessRate,
        currentEligible: currentEligible.get(patternId) ?? true,
      }),
      writeEligibility,
    }
  })

  const writeEffectiveness = deps.writeEffectiveness ?? persistEffectiveness
  await writeEffectiveness(db, id, updates)

  const log = deps.log ?? defaultLog
  if (mode === 'shadow' || mode === 'on') {
    log({
      accountId: id,
      injected: false,
      mode,
      matches: updates.map((row) => ({
        patternId: row.patternId,
        usageCount: row.effectiveness.usageCount,
        eligibleUsageCount: row.effectiveness.eligibleUsageCount,
        observedSuccessRate: row.effectiveness.observedSuccessRate,
        retrievalEligible: row.writeEligibility
          ? row.retrievalEligible
          : currentEligible.get(row.patternId) ?? true,
      })),
    })
  }

  await (deps.upsertCursor ?? upsertEffectivenessCursor)(db, id)
  return {
    accountId: id,
    usageCount: usages.length,
    patternCount: patternIds.length,
    mode,
  }
}

export async function drainPatternEffectivenessJobs(
  db: SupabaseClient,
  opts: {
    limit?: number
    enqueue?: (job: EffectivenessJob) => Promise<boolean>
    evaluate?: typeof evaluateAccountPatternEffectiveness
    listDue?: typeof listAccountsDueForEffectiveness
  } = {}
): Promise<{ queued: number; ran: number; accounts: string[] }> {
  const listDue = opts.listDue ?? listAccountsDueForEffectiveness
  const accounts = await listDue(db, opts.limit ?? ACCOUNTS_PER_CRON)
  let queued = 0
  let ran = 0
  const evaluate = opts.evaluate ?? evaluateAccountPatternEffectiveness
  for (const accountId of accounts) {
    const job: EffectivenessJob = {
      accountId,
      idempotencyKey: effectivenessIdempotencyKey(accountId),
    }
    const enqueued = opts.enqueue ? await opts.enqueue(job) : false
    if (enqueued) {
      queued += 1
      continue
    }
    await evaluate(db, accountId)
    ran += 1
  }
  return { queued, ran, accounts }
}

export async function listAccountsDueForEffectiveness(
  db: SupabaseClient,
  limit = ACCOUNTS_PER_CRON
): Promise<string[]> {
  const { data: recent, error } = await db
    .from('sales_pattern_usages')
    .select('account_id, used_at')
    .order('used_at', { ascending: false })
    .limit(MAX_USAGES_PER_ACCOUNT)
  if (error) throw error
  const rows = (recent ?? []) as Array<{ account_id: string; used_at: string }>
  const newestByAccount = new Map<string, string>()
  for (const row of rows) {
    if (!row.account_id || newestByAccount.has(row.account_id)) continue
    newestByAccount.set(row.account_id, row.used_at)
  }
  if (!newestByAccount.size) return []

  const { data: cursors, error: cursorErr } = await db
    .from('pattern_effectiveness_cursors')
    .select('account_id, last_run_at')
    .in('account_id', [...newestByAccount.keys()])
  if (cursorErr) throw cursorErr
  const cursorByAccount = new Map(
    ((cursors ?? []) as Array<{ account_id: string; last_run_at: string | null }>).map(
      (row) => [row.account_id, row.last_run_at]
    )
  )

  const due: string[] = []
  for (const [accountId, newest] of newestByAccount) {
    const watermark = cursorByAccount.get(accountId)
    if (!watermark || newest > watermark) due.push(accountId)
    if (due.length >= limit) break
  }
  return due
}

async function loadAccountUsages(
  db: SupabaseClient,
  accountId: string
): Promise<SalesPatternUsageRow[]> {
  const { data, error } = await db
    .from('sales_pattern_usages')
    .select(
      'id, account_id, pattern_id, conversation_id, used_at, attribution_status, attributed_event_id, attributed_event_type'
    )
    .eq('account_id', accountId)
    .order('used_at', { ascending: false })
    .limit(MAX_USAGES_PER_ACCOUNT)
  if (error) throw error
  return (data ?? []) as SalesPatternUsageRow[]
}

async function loadAccountTerminalEvents(
  db: SupabaseClient,
  accountId: string,
  conversationIds: string[]
): Promise<TerminalSalesEventRow[]> {
  if (!conversationIds.length) return []
  const { data, error } = await db
    .from('sales_events')
    .select('id, account_id, conversation_id, event_type, kind, created_at')
    .eq('account_id', accountId)
    .eq('kind', 'outcome')
    .in('conversation_id', conversationIds)
  if (error) throw error
  return ((data ?? []) as TerminalSalesEventRow[]).filter((row) =>
    isTerminalOutcomeType(row.event_type)
  )
}

async function loadPatternEligibility(
  db: SupabaseClient,
  accountId: string,
  patternIds: string[]
): Promise<PatternEligibilityRow[]> {
  if (!patternIds.length) return []
  const { data, error } = await db
    .from('sales_patterns')
    .select('id, account_id, retrieval_eligible')
    .eq('account_id', accountId)
    .in('id', patternIds)
  if (error) throw error
  return (data ?? []) as PatternEligibilityRow[]
}

async function persistAttributions(
  db: SupabaseClient,
  accountId: string,
  rows: UsageAttribution[]
): Promise<void> {
  const now = new Date().toISOString()
  for (const row of rows) {
    const { error } = await db
      .from('sales_pattern_usages')
      .update({
        attribution_status: row.attribution_status,
        attributed_event_id: row.attributed_event_id,
        attributed_event_type: row.attributed_event_type,
        updated_at: now,
      })
      .eq('account_id', accountId)
      .eq('id', row.id)
    if (error) throw error
  }
}

async function persistEffectiveness(
  db: SupabaseClient,
  accountId: string,
  updates: PatternEffectivenessUpdate[]
): Promise<void> {
  const now = new Date().toISOString()
  for (const update of updates) {
    const payload: Record<string, unknown> = {
      effectiveness: update.effectiveness,
      last_effectiveness_at: now,
      updated_at: now,
    }
    if (update.writeEligibility) {
      payload.retrieval_eligible = update.retrievalEligible
    }
    const { error } = await db
      .from('sales_patterns')
      .update(payload)
      .eq('account_id', accountId)
      .eq('id', update.patternId)
    if (error) throw error
  }
}

async function upsertEffectivenessCursor(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db.from('pattern_effectiveness_cursors').upsert(
    {
      account_id: accountId,
      last_run_at: new Date().toISOString(),
      analyzer_version: EFFECTIVENESS_ANALYZER_VERSION,
    },
    { onConflict: 'account_id' }
  )
  if (error) throw error
}

function unresolved(id: string): UsageAttribution {
  return {
    id,
    attribution_status: 'unresolved',
    attributed_event_id: null,
    attributed_event_type: null,
  }
}

function emptyEffectiveness(): PatternEffectiveness {
  return {
    usageCount: 0,
    eligibleUsageCount: 0,
    successCount: 0,
    failureCount: 0,
    unresolvedCount: 0,
    observedSuccessRate: null,
    firstUsedAt: null,
    lastUsedAt: null,
  }
}

function defaultLog(payload: Record<string, unknown>): void {
  console.info('[sales-pattern-effectiveness]', {
    accountId: payload.accountId,
    mode: payload.mode,
    matches: payload.matches,
  })
}
