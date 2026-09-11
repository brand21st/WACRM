/**
 * Phase 5 read-only retrieval of active tenant sales patterns.
 *
 * retrieveSalesPatterns does NOT own the feature-flag policy.
 * Callers load the mode first and skip the query when off.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShoppingContext } from '@/lib/catalog/intelligence/types';
import type { SalesTurn } from '@/lib/shopify/sales-turn';
import { requireAccountId, type SalesPattern } from './contracts';
import {
  isControlledAiAccountApproved,
  isEnvironmentKillSwitchEnabled,
} from './controlled-ai-prerequisites';
import {
  contextSource,
  normalizeContextToken,
  priceBandForAmount,
  sanitizePatternContext,
} from './sales-pattern-identity';
import { formatSalesPatternGuidance } from './sales-pattern-prompt';
import {
  CANDIDATE_QUERY_LIMIT,
  MAX_RETURNED_PATTERNS,
  isEligibleMatch,
  isSalesPatternType,
  scoreSalesPattern,
  shouldRetrieveSalesPatterns,
  situationFromTurn,
  type SalesPatternSituation,
} from './sales-pattern-score';
import type {
  PatternContext,
  RecommendedBehavior,
  SalesPatternType,
} from './sales-pattern-types';
import { RECOMMENDED_BEHAVIORS } from './sales-pattern-types';

export type SalesPatternRetrievalMode = 'off' | 'shadow' | 'on';

export type RetrievedSalesPattern = {
  patternId: string;
  patternType: SalesPatternType;
  triggerEventType: string;
  context: PatternContext;
  recommendedBehavior: RecommendedBehavior;
  confidence: number;
  sampleCount: number;
  eligibleOutcomeCount: number;
  successRate: number | null;
  matchScore: number;
  matchReasons: string[];
};

export type SalesPatternRow = {
  id: string;
  account_id: string;
  pattern_type: string;
  trigger_event_type: string;
  context: unknown;
  recommended_behavior: string;
  confidence: number;
  sample_count: number;
  eligible_outcome_count: number;
  evidence: unknown;
  last_observed_at: string | null;
  status: string;
  retrieval_eligible?: boolean;
};

export type RetrieveSalesPatternsArgs = {
  accountId: string;
  patternType: SalesPatternType | null | undefined;
  shopping?: ShoppingContext | null;
  productId?: string | null;
  limit?: number;
};

export type RetrieveSalesPatternsDeps = {
  loadActivePatterns?: (
    db: SupabaseClient,
    accountId: string,
    candidateLimit: number
  ) => Promise<SalesPatternRow[]>;
};

const SELECT_COLUMNS =
  'id, account_id, pattern_type, trigger_event_type, context, recommended_behavior, confidence, sample_count, eligible_outcome_count, evidence, last_observed_at, status, retrieval_eligible';

export async function loadSalesPatternRetrievalMode(
  db: SupabaseClient,
  accountId: string
): Promise<SalesPatternRetrievalMode> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select('sales_pattern_retrieval')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !data) return 'off';
    const mode = (data as { sales_pattern_retrieval?: string })
      .sales_pattern_retrieval;
    if (mode === 'shadow' || mode === 'on') return mode;
    return 'off';
  } catch {
    return 'off';
  }
}

/**
 * Retrieve relevant active sales patterns for this tenant and context.
 * Does not check sales_pattern_retrieval. Callers own that policy.
 */
export async function retrieveSalesPatterns(
  db: SupabaseClient,
  args: RetrieveSalesPatternsArgs,
  deps: RetrieveSalesPatternsDeps = {}
): Promise<RetrievedSalesPattern[]> {
  const accountId = requireAccountId(args.accountId, 'retrieveSalesPatterns');
  if (!args.patternType || !isSalesPatternType(args.patternType)) return [];

  const limit = Math.min(
    MAX_RETURNED_PATTERNS,
    Math.max(1, args.limit ?? MAX_RETURNED_PATTERNS)
  );
  const situation: SalesPatternSituation = {
    patternType: args.patternType,
    category: normalizeContextToken(args.shopping?.categoryHint) || undefined,
    priceBand: situationBand(args.shopping),
    budgetBand: situationBand(args.shopping),
    productId:
      args.productId?.trim() ||
      args.shopping?.selectedIds[0]?.trim() ||
      undefined,
  };

  const loadRows = deps.loadActivePatterns ?? loadActiveSalesPatterns;
  let rows: SalesPatternRow[];
  try {
    rows = await loadRows(db, accountId, CANDIDATE_QUERY_LIMIT);
  } catch (err) {
    console.warn('[sales-patterns] query failed', { accountId });
    void err;
    return [];
  }

  const now = new Date();
  const scored: RetrievedSalesPattern[] = [];
  for (const row of rows) {
    if (row.account_id !== accountId) continue;
    if (row.status !== 'active') continue;
    if (row.retrieval_eligible === false) continue;
    const mapped = toRetrievedPattern(row, situation, now);
    if (!mapped) continue;
    scored.push(mapped);
  }

  scored.sort((a, b) => b.matchScore - a.matchScore);
  return scored.slice(0, limit);
}

export async function loadActiveSalesPatterns(
  db: SupabaseClient,
  accountId: string,
  candidateLimit: number
): Promise<SalesPatternRow[]> {
  const { data, error } = await db
    .from('sales_patterns')
    .select(SELECT_COLUMNS)
    .eq('account_id', accountId)
    .eq('status', 'active')
    .eq('retrieval_eligible', true)
    .order('last_observed_at', { ascending: false })
    .limit(candidateLimit);

  if (error) throw error;
  return Array.isArray(data) ? (data as SalesPatternRow[]) : [];
}

export function toComposerSalesPatterns(
  accountId: string,
  matches: RetrievedSalesPattern[]
): SalesPattern[] {
  return matches.map((match) => ({
    accountId,
    patternType: match.patternType,
    sourceContext: contextSource(match.context),
    confidence: match.confidence,
    evidenceCount: match.sampleCount,
    outcomeMetrics: {
      eligible: match.eligibleOutcomeCount,
      successRate: match.successRate ?? 0,
    },
    active: true,
    version: 1,
  }));
}

export type SalesPatternDiagnostic = {
  accountId: string;
  sourceTurnId: string | null;
  observedAt: string;
  injected: boolean;
  matches: Array<{
    patternId: string;
    patternType: SalesPatternType;
    matchScore: number;
    matchReasons: string[];
  }>;
};

const DIAGNOSTIC_KEYS = [
  'accountId',
  'sourceTurnId',
  'observedAt',
  'injected',
  'matches',
] as const;
const DIAGNOSTIC_MATCH_KEYS = [
  'patternId',
  'patternType',
  'matchScore',
  'matchReasons',
] as const;

export function salesPatternDiagnosticPayload(args: {
  accountId: string;
  sourceTurnId?: string | null;
  observedAt?: string;
  matches: RetrievedSalesPattern[];
  injected: boolean;
}): SalesPatternDiagnostic {
  return {
    accountId: args.accountId,
    sourceTurnId: args.sourceTurnId?.trim() || null,
    observedAt: args.observedAt ?? new Date().toISOString(),
    injected: args.injected,
    matches: args.matches.map((match) => ({
      patternId: match.patternId,
      patternType: match.patternType,
      matchScore: match.matchScore,
      matchReasons: match.matchReasons,
    })),
  };
}

export function assertSafeSalesPatternDiagnostic(
  payload: SalesPatternDiagnostic
): void {
  for (const key of Object.keys(payload)) {
    if (!(DIAGNOSTIC_KEYS as readonly string[]).includes(key)) {
      throw new Error(`unsafe diagnostic key: ${key}`);
    }
  }
  for (const match of payload.matches) {
    for (const key of Object.keys(match)) {
      if (!(DIAGNOSTIC_MATCH_KEYS as readonly string[]).includes(key)) {
        throw new Error(`unsafe diagnostic match key: ${key}`);
      }
    }
  }
}

export function logSalesPatternDiagnostics(
  payload: SalesPatternDiagnostic
): void {
  assertSafeSalesPatternDiagnostic(payload);
  console.info('[sales-patterns]', payload);
}

export async function persistSalesPatternShadowDiagnostics(
  db: SupabaseClient,
  payload: SalesPatternDiagnostic
): Promise<void> {
  assertSafeSalesPatternDiagnostic(payload);
  const accountId = requireAccountId(
    payload.accountId,
    'persistSalesPatternShadowDiagnostics'
  );
  if (!payload.sourceTurnId) return;
  const rows =
    payload.matches.length > 0
      ? payload.matches.map((match) => ({
          account_id: accountId,
          turn_id: payload.sourceTurnId,
          source_turn_id: payload.sourceTurnId,
          pattern_id: match.patternId,
          pattern_type: match.patternType,
          match_score: match.matchScore,
          match_reasons: match.matchReasons,
          injected: false,
          created_at: payload.observedAt,
        }))
      : [
          {
            account_id: accountId,
            turn_id: payload.sourceTurnId,
            source_turn_id: payload.sourceTurnId,
            pattern_id: null,
            pattern_type: null,
            match_score: null,
            match_reasons: [],
            injected: false,
            created_at: payload.observedAt,
          },
        ];
  // Generated DB types can lag the additive diagnostics migration.
  const { error } = await db
    .from('sales_pattern_shadow_diagnostics')
    .upsert(rows as never, {
      onConflict: 'account_id,source_turn_id,pattern_id',
      ignoreDuplicates: true,
    });
  if (error) throw error;
}

export type ResolveSalesPatternGuidanceResult = {
  salesGuidance: string | null;
  queried: boolean;
  matches: RetrievedSalesPattern[];
  mode: SalesPatternRetrievalMode;
};

/**
 * Customer-facing orchestration helper. Shadow evaluation belongs exclusively
 * to the background conversation analyzer and must do no candidate work here.
 */
export async function resolveSalesPatternGuidance(
  db: SupabaseClient,
  args: {
    accountId: string;
    salesTurn: SalesTurn;
    queryText?: string | null;
    shopping?: ShoppingContext | null;
    productId?: string | null;
    sourceTurnId?: string | null;
  },
  deps: {
    loadMode?: typeof loadSalesPatternRetrievalMode;
    retrieve?: typeof retrieveSalesPatterns;
    log?: typeof logSalesPatternDiagnostics;
    persist?: typeof persistSalesPatternShadowDiagnostics;
    allowLive?: (accountId: string) => boolean;
  } = {}
): Promise<ResolveSalesPatternGuidanceResult> {
  const empty: ResolveSalesPatternGuidanceResult = {
    salesGuidance: null,
    queried: false,
    matches: [],
    mode: 'off',
  };

  try {
    const loadMode = deps.loadMode ?? loadSalesPatternRetrievalMode;
    const mode = await loadMode(db, args.accountId);
    if (mode === 'off') return { ...empty, mode };
    if (mode === 'shadow') return { ...empty, mode };
    const allowLive =
      deps.allowLive ??
      ((accountId: string) =>
        isControlledAiAccountApproved(accountId) &&
        !isEnvironmentKillSwitchEnabled(
          process.env.AI_INTELLIGENCE_KILL_LIVE_RETRIEVAL
        ));
    if (!allowLive(args.accountId)) return { ...empty, mode };

    if (!shouldRetrieveSalesPatterns(args.salesTurn, args.queryText)) {
      return { ...empty, mode };
    }

    const situation = situationFromTurn({
      salesTurn: args.salesTurn,
      queryText: args.queryText,
      shopping: args.shopping,
      productId: args.productId,
    });
    if (!situation) return { ...empty, mode };

    const retrieve = deps.retrieve ?? retrieveSalesPatterns;
    const matches = await retrieve(db, {
      accountId: args.accountId,
      patternType: situation.patternType,
      shopping: args.shopping,
      productId: args.productId ?? situation.productId,
    });

    const injected = matches.length > 0;
    const log = deps.log ?? logSalesPatternDiagnostics;
    const payload = salesPatternDiagnosticPayload({
      accountId: args.accountId,
      sourceTurnId: args.sourceTurnId,
      matches,
      injected,
    });
    log(payload);

    return {
      salesGuidance: injected ? formatSalesPatternGuidance(matches) : null,
      queried: true,
      matches,
      mode,
    };
  } catch (err) {
    console.warn('[sales-patterns] resolve failed', {
      accountId: args.accountId,
    });
    void err;
    return empty;
  }
}

/**
 * Produces a stable UUID-shaped diagnostic identity from opaque IDs only.
 * It is safe to retry and does not persist the external provider message ID.
 */
export function stableSourceTurnDiagnosticId(
  accountId: string,
  conversationId: string,
  sourceMessageId: string | null | undefined
): string | null {
  const account = accountId.trim();
  const conversation = conversationId.trim();
  const source = sourceMessageId?.trim();
  if (!account || !conversation || !source) return null;
  const bytes = Buffer.from(
    createHash('sha256')
      .update(`${account}:${conversation}:${source}`)
      .digest()
      .subarray(0, 16)
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function situationBand(shopping?: ShoppingContext | null): string | undefined {
  return priceBandForAmount(shopping?.maxPrice);
}

function toRetrievedPattern(
  row: SalesPatternRow,
  situation: SalesPatternSituation,
  now: Date
): RetrievedSalesPattern | null {
  if (!isSalesPatternType(row.pattern_type)) return null;
  if (!isRecommendedBehavior(row.recommended_behavior)) return null;

  const context = sanitizePatternContext(asPatternContext(row.context));
  const scored = scoreSalesPattern(
    {
      patternType: row.pattern_type,
      triggerEventType: row.trigger_event_type,
      context,
      eligibleOutcomeCount: Number(row.eligible_outcome_count) || 0,
      confidence: Number(row.confidence) || 0,
      lastObservedAt: row.last_observed_at,
    },
    situation,
    now
  );
  if (!isEligibleMatch(scored)) return null;

  return {
    patternId: row.id,
    patternType: row.pattern_type,
    triggerEventType: row.trigger_event_type,
    context,
    recommendedBehavior: row.recommended_behavior,
    confidence: Number(row.confidence) || 0,
    sampleCount: Number(row.sample_count) || 0,
    eligibleOutcomeCount: Number(row.eligible_outcome_count) || 0,
    successRate: readSuccessRate(row.evidence),
    matchScore: scored.score,
    matchReasons: scored.matchReasons,
  };
}

function asPatternContext(raw: unknown): PatternContext {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  return {
    category: typeof value.category === 'string' ? value.category : undefined,
    priceBand:
      typeof value.priceBand === 'string' ? value.priceBand : undefined,
    productId:
      typeof value.productId === 'string' ? value.productId : undefined,
    budgetBand:
      typeof value.budgetBand === 'string' ? value.budgetBand : undefined,
  };
}

function readSuccessRate(evidence: unknown): number | null {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return null;
  }
  const value = (evidence as { successRate?: unknown }).successRate;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecommendedBehavior(value: string): value is RecommendedBehavior {
  return (RECOMMENDED_BEHAVIORS as readonly string[]).includes(value);
}
