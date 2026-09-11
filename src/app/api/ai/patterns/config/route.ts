import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { loadSalesPatternRetrievalMode } from '@/lib/ai/intelligence/retrieve-sales-patterns';
import { setSalesPatternRetrievalMode } from '@/lib/ai/intelligence/ai-intelligence-admin';
import {
  isControlledAiAccountApproved,
  isEnvironmentKillSwitchEnabled,
} from '@/lib/ai/intelligence/controlled-ai-prerequisites';

export async function GET() {
  try {
    const { accountId } = await requireRole('admin');
    const mode = await loadSalesPatternRetrievalMode(
      supabaseAdmin(),
      accountId
    );
    return NextResponse.json({ sales_pattern_retrieval: mode });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-patterns-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const raw =
      body && typeof body === 'object' ? body.sales_pattern_retrieval : null;
    if (raw !== 'off' && raw !== 'shadow' && raw !== 'on') {
      return NextResponse.json(
        { error: 'sales_pattern_retrieval must be off, shadow, or on' },
        { status: 400 }
      );
    }
    if (
      raw === 'on' &&
      (!isControlledAiAccountApproved(accountId) ||
        isEnvironmentKillSwitchEnabled(
          process.env.AI_INTELLIGENCE_KILL_LIVE_RETRIEVAL
        ) ||
        body.confirmation !== 'ENABLE LIVE PATTERN RETRIEVAL')
    ) {
      return NextResponse.json(
        {
          error: 'Live retrieval requires an approved account and confirmation',
        },
        { status: 409 }
      );
    }
    const mode = await setSalesPatternRetrievalMode(
      supabaseAdmin(),
      accountId,
      raw
    );
    return NextResponse.json({ sales_pattern_retrieval: mode });
  } catch (err) {
    return toErrorResponse(err);
  }
}
