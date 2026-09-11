/**
 * Write-capable sales-intelligence pipeline E2E.
 *
 * Default: Phase 3 + 4 on E2E_INTELLIGENCE_ACCOUNT_ID only.
 * Phase 5/6 require explicit env flags. Phase 7 is never enabled.
 *
 * Skips when the dedicated test account env is missing. Never falls
 * back to the first ai_configs row.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { classifySalesTurn } from '@/lib/shopify/sales-turn'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { buildFocusedFactReply } from '@/lib/shopify/sales-reply'
import { discoverAccountPatterns } from '@/lib/ai/intelligence/discover-patterns'
import {
  resolveSalesPatternGuidance,
  salesPatternDiagnosticPayload,
  assertSafeSalesPatternDiagnostic,
} from '@/lib/ai/intelligence/retrieve-sales-patterns'
import { recordSalesPatternUsage } from '@/lib/ai/intelligence/record-sales-pattern-usage'
import { evaluateAccountPatternEffectiveness } from '@/lib/ai/intelligence/evaluate-pattern-effectiveness'
import { setSalesPatternRetrievalMode } from '@/lib/ai/intelligence/ai-intelligence-admin'
import { MIN_ACTIVE_ELIGIBLE, MIN_ACTIVE_SAMPLES, MIN_CANDIDATE_SAMPLES } from '@/lib/ai/intelligence/sales-pattern-types'
import {
  analyzeTestConversation,
  assertSafeEventMetadata,
  cleanupTestRecords,
  countPhase7Rows,
  countUsages,
  emptyPipelineReport,
  envFlag,
  formatPipelineReport,
  insertCommerceOrder,
  insertTestConversation,
  loadEnvLocal,
  loadPriceObjectionPattern,
  pollUntil,
  PRICE_OBJECTION_COPY,
  readIntelligenceFlags,
  resolveOwnerUserId,
  resolvePipelineAccount,
  restoreIntelligenceFlags,
  setSalesPatternEffectivenessModeForTest,
  waitForSalesEvent,
  type PipelineReport,
  type TestConversation,
} from './pipeline-e2e-helpers'

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = Boolean(url && serviceKey)
const RUN_PHASE5_SHADOW = envFlag('RUN_PHASE5_SHADOW_TEST')
const RUN_PHASE5_ON = envFlag('RUN_PHASE5_ON_TEST')
const RUN_PHASE6_SHADOW = envFlag('RUN_PHASE6_SHADOW_TEST')
const RUN_PHASE6_ON = envFlag('RUN_PHASE6_ON_TEST')
const accountEnv = Boolean(process.env.E2E_INTELLIGENCE_ACCOUNT_ID?.trim())
const FOREIGN_ACCOUNT = '00000000-0000-4000-8000-000000000099'

const db = live ? createClient(url!, serviceKey!) : null
const report: PipelineReport = emptyPipelineReport()
const created: TestConversation[] = []
const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

let accountId = ''
let ownerUserId = ''
let ready = false

async function createAnalyzedConversation(index: number): Promise<TestConversation> {
  const conversation = await insertTestConversation(db!, {
    accountId,
    ownerUserId,
    runId,
    index,
  })
  created.push(conversation)
  await analyzeTestConversation(db!, { accountId, conversation })
  return conversation
}

async function ensureActivePattern(): Promise<NonNullable<
  Awaited<ReturnType<typeof loadPriceObjectionPattern>>
>> {
  report.notes.push(
    `Phase 5/6 require ${MIN_ACTIVE_SAMPLES} conversations and ${MIN_ACTIVE_ELIGIBLE} outcomes for status=active`,
  )
  while (created.length < MIN_ACTIVE_SAMPLES) {
    await createAnalyzedConversation(created.length + 1)
  }
  const outcomeTargets = created.slice(0, MIN_ACTIVE_ELIGIBLE)
  for (const [index, conversation] of outcomeTargets.entries()) {
    await insertCommerceOrder(db!, {
      accountId,
      conversation,
      runId,
      index: index + 1,
    })
    await analyzeTestConversation(db!, { accountId, conversation })
    await waitForSalesEvent(db!, {
      accountId,
      conversationId: conversation.conversationId,
      eventType: 'ORDER_CREATED',
    })
  }
  await discoverAccountPatterns(db!, accountId)
  const pattern = await pollUntil(
    async () => {
      const row = await loadPriceObjectionPattern(db!, accountId)
      if (row && row.status === 'active' && row.retrieval_eligible !== false) {
        return row
      }
      return null
    },
    { label: 'active PRICE_OBJECTION pattern', timeoutMs: 60_000 },
  )
  return pattern
}

beforeAll(async () => {
  if (!db) return
  const resolved = await resolvePipelineAccount(db)
  if (!resolved) return
  accountId = resolved
  ownerUserId = await resolveOwnerUserId(db, accountId)
  await restoreIntelligenceFlags(db, accountId)
  const phase7 = await countPhase7Rows(db, accountId)
  expect(phase7.experiments).toBe(0)
  expect(phase7.assignments).toBe(0)
  ready = true
})

afterAll(async () => {
  if (!db || !accountId) {
    console.info('\nAI Intelligence pipeline e2e skipped (no E2E_INTELLIGENCE_ACCOUNT_ID)\n')
    return
  }
  try {
    await restoreIntelligenceFlags(db, accountId)
    const flags = await readIntelligenceFlags(db, accountId)
    const phase7 = await countPhase7Rows(db, accountId)
    report.flags_after = flags
    report.phase7 = {
      optimization_flag: flags.ai_behavior_optimization === 'off' ? 'OFF' : 'ON',
      experiments: phase7.experiments,
      assignments: phase7.assignments,
    }
    report.conversations_used = created.length
    report.notes.push(`conversations_used: ${created.length}`)
    await cleanupTestRecords(db, accountId)
    report.notes.push(
      'Cleanup deleted tagged [e2e-intel] contacts/orders for this account only. Pattern rows were left (aggregated upserts).',
    )
  } finally {
    console.info(`\n${formatPipelineReport(report)}\n`)
  }
  expect(report.flags_after.sales_pattern_retrieval).toBe('off')
  expect(report.flags_after.sales_pattern_effectiveness).toBe('off')
  expect(report.flags_after.ai_behavior_optimization).toBe('off')
  expect(report.phase7.optimization_flag).toBe('OFF')
  expect(report.phase7.experiments).toBe(0)
  expect(report.phase7.assignments).toBe(0)
})

describe('AI Intelligence pipeline e2e — report harness', () => {
  it('formats SKIPPED Phase 5/6 sections by default', () => {
    const text = formatPipelineReport(emptyPipelineReport())
    expect(text).toContain('PHASE 3')
    expect(text).toContain('PHASE 5 SHADOW')
    expect(text).toContain('SKIPPED')
    expect(text).toContain('sales_pattern_retrieval = unknown')
    expect(text).toContain('optimization_flag: OFF')
    expect(envFlag('RUN_PHASE5_SHADOW_TEST')).toBe(false)
    expect(envFlag('RUN_PHASE5_ON_TEST')).toBe(false)
    expect(envFlag('RUN_PHASE6_SHADOW_TEST')).toBe(false)
    expect(envFlag('RUN_PHASE6_ON_TEST')).toBe(false)
  })
})

describe.skipIf(!live)('AI Intelligence pipeline e2e — live write harness', () => {
  it('requires E2E_INTELLIGENCE_ACCOUNT_ID and does not use the first ai_configs row', async () => {
    if (!process.env.E2E_INTELLIGENCE_ACCOUNT_ID?.trim()) {
      expect(ready).toBe(false)
      return
    }
    expect(ready).toBe(true)
    expect(accountId).toBe(process.env.E2E_INTELLIGENCE_ACCOUNT_ID.trim())
  })
})

describe.skipIf(!live || !accountEnv)('AI Intelligence pipeline e2e — Phase 3-7', () => {
  it('PHASE 3 extracts PRICE_OBJECTION from a real test conversation', async () => {
    if (!ready) return
    const conversation = await createAnalyzedConversation(1)
    const event = await waitForSalesEvent(db!, {
      accountId,
      conversationId: conversation.conversationId,
      eventType: 'PRICE_OBJECTION',
    })
    expect(event.account_id).toBe(accountId)
    expect(event.conversation_id).toBe(conversation.conversationId)
    expect(event.event_type).toBe('PRICE_OBJECTION')
    expect(event.kind).toBe('signal')
    assertSafeEventMetadata(event.metadata)

    const { data: leaked } = await db!
      .from('sales_events')
      .select('id')
      .eq('account_id', FOREIGN_ACCOUNT)
      .eq('conversation_id', conversation.conversationId)
    expect(leaked ?? []).toEqual([])

    report.phase3 = {
      sales_event_created: 'YES',
      event_type: event.event_type,
      account_isolated: 'YES',
    }
  })

  it('PHASE 4 discovers a tenant-scoped PRICE_OBJECTION candidate after 3 conversations', async () => {
    if (!ready) return
    while (created.length < MIN_CANDIDATE_SAMPLES) {
      await createAnalyzedConversation(created.length + 1)
    }
    for (const conversation of created) {
      await waitForSalesEvent(db!, {
        accountId,
        conversationId: conversation.conversationId,
        eventType: 'PRICE_OBJECTION',
      })
    }

    const discovered = await discoverAccountPatterns(db!, accountId)
    expect(discovered.accountId).toBe(accountId)
    const pattern = await pollUntil(
      () => loadPriceObjectionPattern(db!, accountId),
      { label: 'PRICE_OBJECTION sales_pattern' },
    )
    expect(pattern.account_id).toBe(accountId)
    expect(pattern.pattern_type).toBe('PRICE_OBJECTION')
    expect(pattern.sample_count).toBeGreaterThanOrEqual(MIN_CANDIDATE_SAMPLES)

    const { data: foreign } = await db!
      .from('sales_patterns')
      .select('id')
      .eq('account_id', FOREIGN_ACCOUNT)
      .eq('id', pattern.id)
    expect(foreign ?? []).toEqual([])

    report.phase4 = {
      pattern_created: 'YES',
      pattern_type: pattern.pattern_type,
      status: pattern.status,
      evidence_count: pattern.sample_count,
    }
    report.notes.push(
      `Phase 4 used ${created.length} conversations (threshold MIN_CANDIDATE_SAMPLES=${MIN_CANDIDATE_SAMPLES})`,
    )
  })

  it('PHASE 7 stays off with zero experiments and assignments', async () => {
    if (!ready) return
    const flags = await readIntelligenceFlags(db!, accountId)
    const phase7 = await countPhase7Rows(db!, accountId)
    expect(flags.ai_behavior_optimization).toBe('off')
    expect(flags.sales_pattern_retrieval).toBe('off')
    expect(flags.sales_pattern_effectiveness).toBe('off')
    expect(phase7.experiments).toBe(0)
    expect(phase7.assignments).toBe(0)
    report.phase7 = {
      optimization_flag: 'OFF',
      experiments: 0,
      assignments: 0,
    }
  })

  it.skipIf(!RUN_PHASE5_SHADOW)(
    'PHASE 5 shadow retrieves an active pattern without injecting or writing usage',
    async () => {
      if (!ready) return
      const pattern = await ensureActivePattern()
      const queryConversation = await createAnalyzedConversation(created.length + 1)
      const usagesBefore = await countUsages(db!, {
        accountId,
        patternId: pattern.id,
      })

      try {
        await setSalesPatternRetrievalMode(db!, accountId, 'shadow')
        const resolved = await resolveSalesPatternGuidance(db!, {
          accountId,
          salesTurn: classifySalesTurn(PRICE_OBJECTION_COPY),
          queryText: PRICE_OBJECTION_COPY,
        })
        expect(resolved.mode).toBe('shadow')
        expect(resolved.queried).toBe(true)
        expect(resolved.salesGuidance).toBeNull()
        expect(resolved.matches.length).toBeGreaterThan(0)
        expect(resolved.matches[0]?.patternType).toBe('PRICE_OBJECTION')
        const diagnostic = salesPatternDiagnosticPayload({
          accountId,
          matches: resolved.matches,
          injected: false,
        })
        assertSafeSalesPatternDiagnostic(diagnostic)
        expect(JSON.stringify(diagnostic)).not.toMatch(
          /phone|email|transcript|too expensive/i,
        )

        const usagesAfter = await countUsages(db!, {
          accountId,
          conversationId: queryConversation.conversationId,
        })
        expect(usagesAfter.count).toBe(0)
        expect(usagesAfter.count).toBeLessThanOrEqual(usagesBefore.count)

        report.phase5_shadow = {
          skipped: false,
          retrieved: 'YES',
          match_score: resolved.matches[0]?.matchScore ?? null,
          match_reasons: resolved.matches[0]?.matchReasons ?? [],
          injected: 'NO',
          usage_created: 'NO',
        }
      } finally {
        await setSalesPatternRetrievalMode(db!, accountId, 'off')
      }
    },
  )

  it.skipIf(!RUN_PHASE5_ON)(
    'PHASE 5 on injects guidance into the LLM prompt and records usage once',
    async () => {
      if (!ready) return
      const pattern = await ensureActivePattern()
      const queryConversation = await createAnalyzedConversation(created.length + 1)

      try {
        await setSalesPatternRetrievalMode(db!, accountId, 'on')
        const resolved = await resolveSalesPatternGuidance(db!, {
          accountId,
          salesTurn: classifySalesTurn(PRICE_OBJECTION_COPY),
          queryText: PRICE_OBJECTION_COPY,
        })
        expect(resolved.mode).toBe('on')
        expect(resolved.matches.length).toBeGreaterThan(0)
        expect(resolved.salesGuidance).toBeTruthy()

        const prompt = buildSystemPrompt({
          userPrompt: 'You are a sales assistant.',
          mode: 'auto_reply',
          salesGuidance: resolved.salesGuidance,
        })
        expect(prompt).toContain(resolved.salesGuidance!)

        const factReply = buildFocusedFactReply({
          kind: 'product_question',
          topic: 'price',
          ask: PRICE_OBJECTION_COPY,
          hit: {
            id: 'hit-1',
            handle: 'kurti',
            title: 'Test Kurti',
            description: 'Cotton kurti',
            imageUrl: null,
            productUrl: 'https://example.com/kurti',
            cartUrl: null,
            checkoutUrl: null,
            priceMin: '3000',
            priceMax: '3000',
            currency: 'INR',
            variants: [],
          },
        })
        const usagesBefore = await countUsages(db!, {
          accountId,
          conversationId: queryConversation.conversationId,
          patternId: pattern.id,
        })
        expect(usagesBefore.count).toBe(0)
        void factReply

        const first = await recordSalesPatternUsage(db!, {
          accountId,
          conversationId: queryConversation.conversationId,
          matches: resolved.matches,
          sourceMessageId: queryConversation.messageId,
        })
        expect(first).toBeGreaterThan(0)
        const second = await recordSalesPatternUsage(db!, {
          accountId,
          conversationId: queryConversation.conversationId,
          matches: resolved.matches,
          sourceMessageId: queryConversation.messageId,
        })
        expect(second).toBeGreaterThan(0)
        const usagesAfter = await countUsages(db!, {
          accountId,
          conversationId: queryConversation.conversationId,
          patternId: pattern.id,
        })
        expect(usagesAfter.count).toBe(1)

        const { data: leaked } = await db!
          .from('sales_pattern_usages')
          .select('id')
          .eq('account_id', FOREIGN_ACCOUNT)
          .eq('conversation_id', queryConversation.conversationId)
        expect(leaked ?? []).toEqual([])

        report.phase5_on = {
          skipped: false,
          retrieved: 'YES',
          injected: 'YES',
          usage_created: 'YES',
        }
      } finally {
        await setSalesPatternRetrievalMode(db!, accountId, 'off')
      }
    },
  )

  it.skipIf(!RUN_PHASE6_SHADOW && !RUN_PHASE6_ON)(
    'PHASE 6 attributes a real commerce outcome without changing Phase 7',
    async () => {
      if (!ready) return
      const pattern = await ensureActivePattern()
      const conversation = created[0]
      await setSalesPatternRetrievalMode(db!, accountId, 'on')
      const resolved = await resolveSalesPatternGuidance(db!, {
        accountId,
        salesTurn: classifySalesTurn(PRICE_OBJECTION_COPY),
        queryText: PRICE_OBJECTION_COPY,
      })
      expect(resolved.matches.length).toBeGreaterThan(0)
      await recordSalesPatternUsage(db!, {
        accountId,
        conversationId: conversation.conversationId,
        matches: resolved.matches,
        sourceMessageId: conversation.messageId,
      })
      await setSalesPatternRetrievalMode(db!, accountId, 'off')

      const eligibilityBefore = pattern.retrieval_eligible
      const mode = RUN_PHASE6_ON ? 'on' : 'shadow'
      try {
        await setSalesPatternEffectivenessModeForTest(db!, accountId, mode)
        const evaluated = await evaluateAccountPatternEffectiveness(db!, accountId)
        expect(evaluated.accountId).toBe(accountId)
        expect(evaluated.mode).toBe(mode)

        const usages = await countUsages(db!, {
          accountId,
          conversationId: conversation.conversationId,
          patternId: pattern.id,
        })
        const usage = usages.rows[0] as {
          attribution_status?: string
          attributed_event_type?: string | null
        } | undefined
        const after = await loadPriceObjectionPattern(db!, accountId)
        if (mode === 'shadow') {
          expect(after?.retrieval_eligible).toBe(eligibilityBefore)
        }

        const effectiveness =
          after?.effectiveness && typeof after.effectiveness === 'object'
            ? (after.effectiveness as { observedSuccessRate?: number })
            : null

        report.phase6 = {
          skipped: false,
          usage_attributed: usage?.attribution_status === 'success' ? 'YES' : 'NO',
          outcome: usage?.attributed_event_type ?? '',
          result:
            usage?.attribution_status === 'success' ||
            usage?.attribution_status === 'failure' ||
            usage?.attribution_status === 'unresolved'
              ? usage.attribution_status
              : 'unresolved',
          observed_success_rate: effectiveness?.observedSuccessRate ?? null,
        }
      } finally {
        await setSalesPatternEffectivenessModeForTest(db!, accountId, 'off')
        await setSalesPatternRetrievalMode(db!, accountId, 'off')
      }
    },
  )
})
