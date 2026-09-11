import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const SELECT =
  'background_learning_mode, background_learning_paused, background_learning_daily_conversation_limit, background_learning_daily_token_limit, recommendation_intelligence';

type LearningMode = 'off' | 'deterministic' | 'hybrid';
type RecommendationMode = 'off' | 'shadow';

export const DEFAULT_LEARNING_CONFIG = {
  background_learning_mode: 'off' as const,
  background_learning_paused: false,
  background_learning_daily_conversation_limit: 100,
  background_learning_daily_token_limit: 25_000,
  recommendation_intelligence: 'off' as const,
  available: true,
};

function normalizeLearningMode(value: unknown): LearningMode | null {
  return value === 'off' || value === 'deterministic' || value === 'hybrid'
    ? value
    : null;
}

function normalizeRecommendationMode(
  value: unknown
): RecommendationMode | null {
  return value === 'off' || value === 'shadow' ? value : null;
}

function isLearningSchemaMissing(
  error: {
    code?: string;
    message?: string;
  } | null
): boolean {
  if (!error) return false;
  const code = error.code ?? '';
  const message = error.message ?? '';
  return (
    (code === '42703' || code === 'PGRST204') &&
    /background_learning_|recommendation_intelligence/i.test(message)
  );
}

function learningConfigFromRow(
  data: Record<string, unknown> | null,
  available = true
) {
  return {
    background_learning_mode:
      normalizeLearningMode(data?.background_learning_mode) ?? 'off',
    background_learning_paused: data?.background_learning_paused === true,
    background_learning_daily_conversation_limit:
      Number(data?.background_learning_daily_conversation_limit) || 100,
    background_learning_daily_token_limit:
      Number(data?.background_learning_daily_token_limit) || 25_000,
    recommendation_intelligence:
      normalizeRecommendationMode(data?.recommendation_intelligence) ?? 'off',
    available,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('admin');
    const { data, error } = await supabase
      .from('ai_configs')
      .select(SELECT)
      .eq('account_id', accountId)
      .maybeSingle();
    if (isLearningSchemaMissing(error)) {
      return NextResponse.json(
        { ...DEFAULT_LEARNING_CONFIG, available: false },
        { headers: { 'Cache-Control': 'private, no-store' } }
      );
    }
    if (error) throw error;
    return NextResponse.json(learningConfigFromRow(data), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-learning-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    const update: Record<string, unknown> = {};
    if ('background_learning_mode' in body) {
      const mode = normalizeLearningMode(body.background_learning_mode);
      if (!mode) {
        return NextResponse.json(
          { error: 'Invalid background learning mode' },
          { status: 400 }
        );
      }
      if (mode === 'hybrid' && body.confirmation !== 'ENABLE HYBRID LEARNING') {
        return NextResponse.json(
          { error: 'Hybrid learning requires explicit confirmation' },
          { status: 409 }
        );
      }
      update.background_learning_mode = mode;
    }
    if ('background_learning_paused' in body) {
      update.background_learning_paused =
        body.background_learning_paused === true;
    }
    if ('background_learning_daily_conversation_limit' in body) {
      const value = Number(body.background_learning_daily_conversation_limit);
      if (!Number.isInteger(value) || value < 1 || value > 1000) {
        return NextResponse.json(
          { error: 'Conversation limit must be between 1 and 1000' },
          { status: 400 }
        );
      }
      update.background_learning_daily_conversation_limit = value;
    }
    if ('background_learning_daily_token_limit' in body) {
      const value = Number(body.background_learning_daily_token_limit);
      if (!Number.isInteger(value) || value < 1000 || value > 250_000) {
        return NextResponse.json(
          { error: 'Token limit must be between 1000 and 250000' },
          { status: 400 }
        );
      }
      update.background_learning_daily_token_limit = value;
    }
    if ('recommendation_intelligence' in body) {
      const mode = normalizeRecommendationMode(
        body.recommendation_intelligence
      );
      if (!mode) {
        return NextResponse.json(
          { error: 'Invalid recommendation intelligence mode' },
          { status: 400 }
        );
      }
      update.recommendation_intelligence = mode;
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: 'No supported changes' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('ai_configs')
      .update(update)
      .eq('account_id', accountId)
      .select(SELECT)
      .single();
    if (isLearningSchemaMissing(error)) {
      return NextResponse.json(
        { error: 'Learning controls are not available yet' },
        { status: 409 }
      );
    }
    if (error) throw error;
    return NextResponse.json(learningConfigFromRow(data), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
