import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import {
  AiBehaviorAdminError,
  startAiBehaviorExperiment,
} from '@/lib/ai/intelligence/ai-behavior-admin';
import {
  isControlledAiAccountApproved,
  isEnvironmentKillSwitchEnabled,
} from '@/lib/ai/intelligence/controlled-ai-prerequisites';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-behavior-start:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (
      !isControlledAiAccountApproved(accountId) ||
      isEnvironmentKillSwitchEnabled(
        process.env.AI_INTELLIGENCE_KILL_OPTIMIZATION
      ) ||
      body?.confirmation !== 'START CONTROLLED EXPERIMENT'
    ) {
      return NextResponse.json(
        {
          error: 'Starting an experiment requires explicit production approval',
        },
        { status: 409 }
      );
    }
    const { id } = await context.params;
    await startAiBehaviorExperiment(supabaseAdmin(), accountId, id);
    return NextResponse.json({ ok: true, id, status: 'running' });
  } catch (err) {
    if (err instanceof AiBehaviorAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return toErrorResponse(err);
  }
}
