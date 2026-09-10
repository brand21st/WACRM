/**
 * Phase 4 pattern discovery. Runs on cron / BullMQ — never on the
 * live WhatsApp reply path.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAccountId } from './contracts'
import {
  aggregateSalesEvents,
  patternLifecycleStatus,
  type AggregateSalesEvent,
} from './aggregate-sales-events'
import { contextSource } from './sales-pattern-identity'
import {
  ACCOUNTS_PER_CRON,
  CATALOG_PRICE_LOOKUP_CAP,
  MAX_EVENTS_PER_ACCOUNT,
  MIN_CANDIDATE_SAMPLES,
  PATTERN_ANALYZER_VERSION,
  type AggregatedPattern,
} from './sales-pattern-types'

export interface DiscoverPatternsResult {
  accountId: string
  wrote: number
  staleUpdated: number
  skipped: boolean
  reason?: string
}

export interface PatternDiscoverJob {
  accountId: string
  idempotencyKey: string
}

export interface DiscoverPatternsDeps {
  loadEvents?: typeof loadAccountSalesEvents
  loadCatalogPrices?: typeof loadCatalogPrices
  loadExistingPatterns?: typeof loadExistingPatterns
  upsertPatterns?: typeof upsertSalesPatterns
  markMissingPatterns?: typeof markMissingPatterns
  upsertCursor?: typeof upsertDiscoveryCursor
}

export async function discoverAccountPatterns(
  db: SupabaseClient,
  accountId: string,
  deps: DiscoverPatternsDeps = {},
): Promise<DiscoverPatternsResult> {
  const id = requireAccountId(accountId, 'discoverAccountPatterns')
  const loadEvents = deps.loadEvents ?? loadAccountSalesEvents
  const events = await loadEvents(db, id)
  const scoped = events.filter((row) => row.account_id === id)
  if (!scoped.length) {
    const saveCursor = deps.upsertCursor ?? upsertDiscoveryCursor
    await saveCursor(db, { accountId: id, lastEventCreatedAt: null })
    return { accountId: id, wrote: 0, staleUpdated: 0, skipped: true, reason: 'no_events' }
  }

  const productIds = uniqueProductIds(scoped).slice(0, CATALOG_PRICE_LOOKUP_CAP)
  const catalogPrices = productIds.length
    ? await (deps.loadCatalogPrices ?? loadCatalogPrices)(db, id, productIds)
    : new Map<string, number>()

  const now = new Date()
  const aggregated = aggregateSalesEvents({
    accountId: id,
    events: scoped,
    catalogPrices,
    now,
  })

  const existing = await (deps.loadExistingPatterns ?? loadExistingPatterns)(db, id)
  const wrote = aggregated.length
    ? await (deps.upsertPatterns ?? upsertSalesPatterns)(db, aggregated, existing, now)
    : 0

  const keepKeys = new Set(aggregated.map((row) => row.patternKey))
  const staleUpdated = await (deps.markMissingPatterns ?? markMissingPatterns)(
    db,
    id,
    existing,
    keepKeys,
    now,
  )

  const newest = scoped.reduce(
    (max, row) => (row.created_at > max ? row.created_at : max),
    scoped[0].created_at,
  )
  await (deps.upsertCursor ?? upsertDiscoveryCursor)(db, {
    accountId: id,
    lastEventCreatedAt: newest,
  })

  return { accountId: id, wrote, staleUpdated, skipped: false }
}

export async function drainPatternDiscoveryJobs(
  db: SupabaseClient,
  opts: {
    limit?: number
    enqueue?: (job: PatternDiscoverJob) => Promise<boolean>
    discover?: typeof discoverAccountPatterns
    listDue?: typeof listAccountsDueForPatternDiscovery
  } = {},
): Promise<{ queued: number; ran: number; accounts: string[] }> {
  const listDue = opts.listDue ?? listAccountsDueForPatternDiscovery
  const accounts = await listDue(db, opts.limit ?? ACCOUNTS_PER_CRON)
  let queued = 0
  let ran = 0
  const discover = opts.discover ?? discoverAccountPatterns
  for (const accountId of accounts) {
    const job: PatternDiscoverJob = {
      accountId,
      idempotencyKey: `${accountId}:patterns`,
    }
    const enqueued = opts.enqueue ? await opts.enqueue(job) : false
    if (enqueued) {
      queued += 1
      continue
    }
    await discover(db, accountId)
    ran += 1
  }
  return { queued, ran, accounts }
}

export async function listAccountsDueForPatternDiscovery(
  db: SupabaseClient,
  limit = ACCOUNTS_PER_CRON,
): Promise<string[]> {
  const { data: recent, error } = await db
    .from('sales_events')
    .select('account_id, created_at')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error
  const rows = (recent ?? []) as Array<{ account_id: string; created_at: string }>
  const newestByAccount = new Map<string, string>()
  for (const row of rows) {
    if (!row.account_id || newestByAccount.has(row.account_id)) continue
    newestByAccount.set(row.account_id, row.created_at)
  }
  if (!newestByAccount.size) return []

  const { data: cursors, error: cursorErr } = await db
    .from('pattern_discovery_cursors')
    .select('account_id, last_event_created_at')
    .in('account_id', [...newestByAccount.keys()])
  if (cursorErr) throw cursorErr
  const cursorByAccount = new Map(
    ((cursors ?? []) as Array<{ account_id: string; last_event_created_at: string | null }>).map(
      (row) => [row.account_id, row.last_event_created_at],
    ),
  )

  const due: string[] = []
  for (const [accountId, newest] of newestByAccount) {
    const watermark = cursorByAccount.get(accountId)
    if (!watermark || newest > watermark) due.push(accountId)
    if (due.length >= limit) break
  }
  return due
}

export async function loadAccountSalesEvents(
  db: SupabaseClient,
  accountId: string,
): Promise<AggregateSalesEvent[]> {
  const { data, error } = await db
    .from('sales_events')
    .select('account_id, conversation_id, event_type, kind, metadata, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(MAX_EVENTS_PER_ACCOUNT)
  if (error) throw error
  return ((data ?? []) as AggregateSalesEvent[]).filter((row) => row.account_id === accountId)
}

export async function loadCatalogPrices(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, number>> {
  if (!productIds.length) return new Map()
  const { data, error } = await db
    .from('catalog_products')
    .select('id, price_min')
    .eq('account_id', accountId)
    .in('id', productIds)
  if (error) throw error
  const prices = new Map<string, number>()
  for (const row of (data ?? []) as Array<{ id: string; price_min?: number | null }>) {
    if (row.price_min != null && Number.isFinite(Number(row.price_min))) {
      prices.set(row.id, Number(row.price_min))
    }
  }
  return prices
}

export interface ExistingPatternRow {
  pattern_key: string
  created_at: string
  last_observed_at: string | null
  status: string
}

export async function loadExistingPatterns(
  db: SupabaseClient,
  accountId: string,
): Promise<ExistingPatternRow[]> {
  const { data, error } = await db
    .from('sales_patterns')
    .select('pattern_key, created_at, last_observed_at, status')
    .eq('account_id', accountId)
  if (error) throw error
  return (data ?? []) as ExistingPatternRow[]
}

export async function upsertSalesPatterns(
  db: SupabaseClient,
  patterns: AggregatedPattern[],
  existing: ExistingPatternRow[],
  now: Date,
): Promise<number> {
  if (!patterns.length) return 0
  const created = new Map(existing.map((row) => [row.pattern_key, row.created_at]))
  const rows = patterns.map((pattern) => toInsertRow(pattern, created.get(pattern.patternKey), now))
  const { error } = await db.from('sales_patterns').upsert(rows, {
    onConflict: 'account_id,pattern_key',
  })
  if (error) throw error
  return rows.length
}

export async function markMissingPatterns(
  db: SupabaseClient,
  accountId: string,
  existing: ExistingPatternRow[],
  keepKeys: Set<string>,
  now: Date,
): Promise<number> {
  const updates = existing
    .filter((row) => !keepKeys.has(row.pattern_key))
    .map((row) => ({
      pattern_key: row.pattern_key,
      status: patternLifecycleStatus({
        sampleCount: MIN_CANDIDATE_SAMPLES,
        eligibleOutcomeCount: 0,
        lastObservedAt: row.last_observed_at,
        now,
      }),
    }))
    .filter((row) => row.status === 'stale' || row.status === 'archived')
  let updated = 0
  for (const row of updates) {
    const { error } = await db
      .from('sales_patterns')
      .update({
        status: row.status,
        last_evaluated_at: now.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('account_id', accountId)
      .eq('pattern_key', row.pattern_key)
    if (error) throw error
    updated += 1
  }
  return updated
}

export async function upsertDiscoveryCursor(
  db: SupabaseClient,
  args: { accountId: string; lastEventCreatedAt: string | null },
): Promise<void> {
  const { error } = await db.from('pattern_discovery_cursors').upsert(
    {
      account_id: args.accountId,
      last_event_created_at: args.lastEventCreatedAt,
      last_run_at: new Date().toISOString(),
      analyzer_version: PATTERN_ANALYZER_VERSION,
    },
    { onConflict: 'account_id' },
  )
  if (error) throw error
}

function toInsertRow(
  pattern: AggregatedPattern,
  createdAt: string | undefined,
  now: Date,
) {
  return {
    account_id: pattern.accountId,
    pattern_key: pattern.patternKey,
    pattern_type: pattern.patternType,
    trigger_event_type: pattern.triggerEventType,
    context: pattern.context,
    recommended_behavior: pattern.recommendedBehavior,
    evidence: pattern.evidence,
    confidence: pattern.confidence,
    sample_count: pattern.sampleCount,
    success_count: pattern.successCount,
    failure_count: pattern.failureCount,
    eligible_outcome_count: pattern.eligibleOutcomeCount,
    unresolved_count: pattern.unresolvedCount,
    status: pattern.status,
    analyzer_version: PATTERN_ANALYZER_VERSION,
    first_observed_at: pattern.firstObservedAt,
    last_observed_at: pattern.lastObservedAt,
    last_evaluated_at: now.toISOString(),
    created_at: createdAt ?? now.toISOString(),
    updated_at: now.toISOString(),
  }
}

function uniqueProductIds(events: AggregateSalesEvent[]): string[] {
  const ids = new Set<string>()
  for (const event of events) {
    const metadata = event.metadata
    const productId =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? typeof (metadata as { productId?: unknown }).productId === 'string'
          ? (metadata as { productId: string }).productId.trim()
          : ''
        : ''
    if (productId) ids.add(productId)
  }
  return [...ids]
}

/** Phase 1-compatible view of a stored pattern. */
export function toSalesPatternContract(pattern: AggregatedPattern) {
  return {
    accountId: pattern.accountId,
    patternType: pattern.patternType,
    sourceContext: contextSource(pattern.context),
    confidence: pattern.confidence,
    evidenceCount: pattern.sampleCount,
    outcomeMetrics: {
      success: pattern.successCount,
      failure: pattern.failureCount,
      eligible: pattern.eligibleOutcomeCount,
      unresolved: pattern.unresolvedCount,
    },
    active: pattern.status === 'active',
    version: 1,
    patternKey: pattern.patternKey,
    status: pattern.status,
  }
}
