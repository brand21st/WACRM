/**
 * Read-only live-DB checks for the AI Intelligence admin helpers.
 * Skips when .env.local is missing. Never writes flags or experiments.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  getAccountExperimentDetail,
  getAccountSalesPattern,
  listAccountSalesPatterns,
  loadExperimentConfigExtras,
  loadIntelligenceOverview,
} from './ai-intelligence-admin'
import { loadAiBehaviorOptimizationMode } from './assign-ai-behavior'
import { loadSalesPatternRetrievalMode } from './retrieve-sales-patterns'
import { startAiBehaviorExperiment } from './ai-behavior-admin'

function loadEnvLocal() {
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

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = Boolean(url && serviceKey)

const FOREIGN_ID = '00000000-0000-4000-8000-000000000099'

describe.skipIf(!live)('AI Intelligence admin helpers against live DB', () => {
  const db = createClient(url!, serviceKey!)

  async function merchantAccountId(): Promise<string> {
    const { data, error } = await db
      .from('ai_configs')
      .select('account_id')
      .limit(1)
      .maybeSingle()
    if (error || !data?.account_id) {
      throw new Error('expected an ai_configs row for live DB tests')
    }
    return data.account_id as string
  }

  it('overview is account-scoped and treats missing sales_patterns as unavailable', async () => {
    const accountId = await merchantAccountId()
    const overview = await loadIntelligenceOverview(db, accountId)
    expect(overview.flags.ai_behavior_optimization).toBe('off')
    expect(overview.flags.sales_pattern_retrieval).toBe('off')
    expect(overview.patterns.available).toBe(true)
    expect(overview.patterns.retrieval_eligible_count).toBe(0)
    expect(overview.experiments.available).toBe(true)
    expect(overview.experiments.by_status.running ?? 0).toBe(0)
    expect(overview.experiments.by_status.draft ?? 0).toBe(0)
    if (overview.knowledge.available) {
      expect(overview.knowledge.document_count).toBeGreaterThanOrEqual(0)
    }
  })

  it('pattern list/detail stay isolated and do not 500 when the table is missing', async () => {
    const accountId = await merchantAccountId()
    const listed = await listAccountSalesPatterns(db, accountId)
    expect(listed).toEqual({ available: true, patterns: [] })
    const detail = await getAccountSalesPattern(db, accountId, FOREIGN_ID)
    expect(detail).toEqual({ available: true, pattern: null })
  })

  it('experiment detail 404s for ids that are not in this account', async () => {
    const accountId = await merchantAccountId()
    const detail = await getAccountExperimentDetail(db, accountId, FOREIGN_ID)
    expect(detail).toBeNull()
    const extras = await loadExperimentConfigExtras(db, accountId)
    expect(extras.live_experiment).toBeNull()
  })

  it('flag loaders stay off and start of a missing experiment does not insert rows', async () => {
    const accountId = await merchantAccountId()
    await expect(loadAiBehaviorOptimizationMode(db, accountId)).resolves.toBe(
      'off',
    )
    await expect(loadSalesPatternRetrievalMode(db, accountId)).resolves.toBe(
      'off',
    )

    const before = await db
      .from('ai_behavior_experiments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    await expect(
      startAiBehaviorExperiment(db, accountId, FOREIGN_ID),
    ).rejects.toThrow()
    const after = await db
      .from('ai_behavior_experiments')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    expect(after.count).toBe(before.count)
    expect(after.count).toBe(0)
  })
})
