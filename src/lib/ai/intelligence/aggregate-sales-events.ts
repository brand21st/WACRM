/**
 * Pure Phase 4 aggregator. Conversation is the sample unit.
 * No I/O. Tenant filtering is the caller's job.
 */

import {
  ARCHIVE_DAYS,
  BEHAVIOR_FOR_PATTERN,
  FAILURE_OUTCOME_TYPES,
  MAX_PATTERNS_PER_ACCOUNT,
  MIN_ACTIVE_ELIGIBLE,
  MIN_ACTIVE_SAMPLES,
  MIN_CANDIDATE_SAMPLES,
  PRODUCT_SPECIALIZE_MIN,
  STALE_DAYS,
  SUCCESS_OUTCOME_TYPES,
  type AggregatedPattern,
  type ConversationOutcome,
  type PatternContext,
  type SalesPatternStatus,
  type SalesPatternType,
  isGenericSignal,
  mapSignalToPatternType,
} from './sales-pattern-types'
import {
  buildPatternKey,
  priceBandForAmount,
  sanitizePatternContext,
} from './sales-pattern-identity'

export interface AggregateSalesEvent {
  id?: string
  account_id: string
  conversation_id: string
  event_type: string
  kind: string
  metadata?: Record<string, unknown> | null
  created_at: string
}

export interface AggregateSalesEventsInput {
  accountId: string
  events: AggregateSalesEvent[]
  catalogPrices?: Map<string, number>
  now?: Date
}

interface ConversationSignal {
  patternType: SalesPatternType
  category?: string
  productId?: string
  budgetMax?: number
  createdAt: string
}

interface ConversationBucket {
  conversationId: string
  outcome: ConversationOutcome
  firstAt: string
  lastAt: string
  signalCount: number
  outcomeCount: number
  signals: ConversationSignal[]
}

export function conversationOutcomeFromEvents(
  events: AggregateSalesEvent[],
): ConversationOutcome {
  let success = false
  let failure = false
  for (const event of events) {
    if (event.kind !== 'outcome') continue
    if (SUCCESS_OUTCOME_TYPES.has(event.event_type)) success = true
    if (FAILURE_OUTCOME_TYPES.has(event.event_type)) failure = true
  }
  if (success) return 'success'
  if (failure) return 'failure'
  return 'unresolved'
}

export function patternConfidence(eligibleOutcomeCount: number): number {
  if (eligibleOutcomeCount <= 0) return 0
  return eligibleOutcomeCount / (eligibleOutcomeCount + 5)
}

export function patternLifecycleStatus(args: {
  sampleCount: number
  eligibleOutcomeCount: number
  lastObservedAt: string | null
  now: Date
}): SalesPatternStatus {
  const last = args.lastObservedAt ? new Date(args.lastObservedAt).getTime() : NaN
  if (Number.isFinite(last)) {
    const ageDays = (args.now.getTime() - last) / 86_400_000
    if (ageDays >= ARCHIVE_DAYS) return 'archived'
    if (ageDays >= STALE_DAYS) return 'stale'
  }
  if (
    args.sampleCount >= MIN_ACTIVE_SAMPLES &&
    args.eligibleOutcomeCount >= MIN_ACTIVE_ELIGIBLE
  ) {
    return 'active'
  }
  return 'candidate'
}

export function aggregateSalesEvents(
  input: AggregateSalesEventsInput,
): AggregatedPattern[] {
  const accountId = input.accountId.trim()
  const now = input.now ?? new Date()
  const conversations = groupConversations(input.events, accountId)
  const samples = expandConversationSamples(conversations, input.catalogPrices)
  const specialized = applyProductSpecialization(samples)
  return finalizePatterns(accountId, specialized, now)
}

function groupConversations(
  events: AggregateSalesEvent[],
  accountId: string,
): ConversationBucket[] {
  const byConv = new Map<string, AggregateSalesEvent[]>()
  for (const event of events) {
    if (event.account_id !== accountId) continue
    const list = byConv.get(event.conversation_id) ?? []
    list.push(event)
    byConv.set(event.conversation_id, list)
  }

  const buckets: ConversationBucket[] = []
  for (const [conversationId, rows] of byConv) {
    const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const specific = new Set<SalesPatternType>()
    const signals: ConversationSignal[] = []
    let signalCount = 0
    let outcomeCount = 0

    for (const row of sorted) {
      if (row.kind === 'outcome') outcomeCount += 1
      const mapped = mapSignalToPatternType(row.event_type)
      if (mapped) {
        signalCount += 1
        specific.add(mapped)
        signals.push(signalFromRow(mapped, row))
        continue
      }
      if (isGenericSignal(row.event_type)) signalCount += 1
    }

    if (specific.size === 0) {
      const hasGeneric = sorted.some((row) => isGenericSignal(row.event_type))
      if (hasGeneric) {
        const firstGeneric = sorted.find((row) => isGenericSignal(row.event_type))
        if (firstGeneric) {
          signals.push(signalFromRow('GENERAL_SALES', firstGeneric))
        }
      }
    }

    if (!signals.length) continue

    buckets.push({
      conversationId,
      outcome: conversationOutcomeFromEvents(sorted),
      firstAt: sorted[0].created_at,
      lastAt: sorted[sorted.length - 1].created_at,
      signalCount,
      outcomeCount,
      signals: uniqueSignals(signals),
    })
  }
  return buckets
}

interface PatternSample {
  patternType: SalesPatternType
  context: PatternContext
  outcome: ConversationOutcome
  firstAt: string
  lastAt: string
  signalCount: number
  outcomeCount: number
}

function expandConversationSamples(
  conversations: ConversationBucket[],
  catalogPrices?: Map<string, number>,
): PatternSample[] {
  const samples: PatternSample[] = []
  for (const conv of conversations) {
    for (const signal of conv.signals) {
      const budgetBand = priceBandForAmount(signal.budgetMax)
      const catalogBand = signal.productId
        ? priceBandForAmount(catalogPrices?.get(signal.productId))
        : undefined
      const priceBand = budgetBand ?? catalogBand
      const context = sanitizePatternContext({
        category: signal.category,
        priceBand,
        budgetBand,
        productId: signal.productId,
      })
      samples.push({
        patternType: signal.patternType,
        context,
        outcome: conv.outcome,
        firstAt: conv.firstAt,
        lastAt: conv.lastAt,
        signalCount: conv.signalCount,
        outcomeCount: conv.outcomeCount,
      })
    }
  }
  return samples
}

function applyProductSpecialization(samples: PatternSample[]): PatternSample[] {
  const counts = new Map<string, number>()
  for (const sample of samples) {
    const productId = sample.context.productId
    if (!productId) continue
    const key = specializeCountKey(sample)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return samples.map((sample) => {
    const productId = sample.context.productId
    if (!productId) return sample
    const n = counts.get(specializeCountKey(sample)) ?? 0
    if (n >= PRODUCT_SPECIALIZE_MIN) return sample
    const rest = { ...sample.context }
    delete rest.productId
    return { ...sample, context: rest }
  })
}

function specializeCountKey(sample: PatternSample): string {
  return [
    sample.patternType,
    sample.context.category ?? '',
    sample.context.priceBand ?? '',
    sample.context.productId ?? '',
  ].join('|')
}

function finalizePatterns(
  accountId: string,
  samples: PatternSample[],
  now: Date,
): AggregatedPattern[] {
  const groups = new Map<string, PatternSample[]>()
  for (const sample of samples) {
    const key = buildPatternKey({
      accountId,
      patternType: sample.patternType,
      triggerEventType: sample.patternType,
      context: sample.context,
    })
    const list = groups.get(key) ?? []
    list.push(sample)
    groups.set(key, list)
  }

  const patterns: AggregatedPattern[] = []
  for (const [patternKey, list] of groups) {
    if (list.length < MIN_CANDIDATE_SAMPLES) continue
    const first = list[0]
    let success = 0
    let failure = 0
    let unresolved = 0
    let signalCount = 0
    let outcomeCount = 0
    let firstAt = list[0].firstAt
    let lastAt = list[0].lastAt
    for (const sample of list) {
      if (sample.outcome === 'success') success += 1
      else if (sample.outcome === 'failure') failure += 1
      else unresolved += 1
      signalCount += sample.signalCount
      outcomeCount += sample.outcomeCount
      if (sample.firstAt < firstAt) firstAt = sample.firstAt
      if (sample.lastAt > lastAt) lastAt = sample.lastAt
    }
    const eligible = success + failure
    const successRate = eligible === 0 ? null : success / eligible
    patterns.push({
      accountId,
      patternKey,
      patternType: first.patternType,
      triggerEventType: first.patternType,
      context: first.context,
      recommendedBehavior: BEHAVIOR_FOR_PATTERN[first.patternType],
      evidence: {
        signalCount,
        outcomeCount,
        successRate,
        firstObservedAt: firstAt,
        lastObservedAt: lastAt,
      },
      confidence: patternConfidence(eligible),
      sampleCount: list.length,
      successCount: success,
      failureCount: failure,
      eligibleOutcomeCount: eligible,
      unresolvedCount: unresolved,
      status: patternLifecycleStatus({
        sampleCount: list.length,
        eligibleOutcomeCount: eligible,
        lastObservedAt: lastAt,
        now,
      }),
      firstObservedAt: firstAt,
      lastObservedAt: lastAt,
    })
  }

  return patterns
    .sort((a, b) => {
      if (b.eligibleOutcomeCount !== a.eligibleOutcomeCount) {
        return b.eligibleOutcomeCount - a.eligibleOutcomeCount
      }
      return b.sampleCount - a.sampleCount
    })
    .slice(0, MAX_PATTERNS_PER_ACCOUNT)
}

function signalFromRow(
  patternType: SalesPatternType,
  row: AggregateSalesEvent,
): ConversationSignal {
  const metadata = asRecord(row.metadata)
  const budgetRaw = metadata?.budgetMax
  const budgetMax =
    typeof budgetRaw === 'number'
      ? budgetRaw
      : typeof budgetRaw === 'string'
        ? Number(budgetRaw)
        : undefined
  return {
    patternType,
    category: str(metadata?.category),
    productId: str(metadata?.productId),
    budgetMax: Number.isFinite(budgetMax) ? budgetMax : undefined,
    createdAt: row.created_at,
  }
}

function uniqueSignals(signals: ConversationSignal[]): ConversationSignal[] {
  const seen = new Set<SalesPatternType>()
  const out: ConversationSignal[] = []
  for (const signal of signals) {
    if (seen.has(signal.patternType)) continue
    seen.add(signal.patternType)
    out.push(signal)
  }
  return out
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}
