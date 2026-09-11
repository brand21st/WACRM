import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { loadAiBehaviorOptimizationMode } from '@/lib/ai/intelligence/assign-ai-behavior';
import { setAiBehaviorOptimizationMode } from '@/lib/ai/intelligence/ai-behavior-admin';
import { loadExperimentConfigExtras } from '@/lib/ai/intelligence/ai-intelligence-admin';
import {
  isControlledAiAccountApproved,
  isEnvironmentKillSwitchEnabled,
} from '@/lib/ai/intelligence/controlled-ai-prerequisites';

export async function GET() {
  try {
    const { accountId } = await requireRole('admin');
    const db = supabaseAdmin();
    const [mode, extras] = await Promise.all([
      loadAiBehaviorOptimizationMode(db, accountId),
      loadExperimentConfigExtras(db, accountId),
    ]);
    return NextResponse.json({
      ai_behavior_optimization: mode,
      ...extras,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin');
    const limit = checkRateLimit(
      `ai-behavior-config:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    const enabled =
      body &&
      typeof body === 'object' &&
      (body.ai_behavior_optimization === 'on' || body.enabled === true);
    if (
      enabled &&
      (!isControlledAiAccountApproved(accountId) ||
        isEnvironmentKillSwitchEnabled(
          process.env.AI_INTELLIGENCE_KILL_OPTIMIZATION
        ) ||
        body.confirmation !== 'ENABLE CONTROLLED OPTIMIZATION')
    ) {
      return NextResponse.json(
        {
          error:
            'Optimization requires an approved account and explicit confirmation',
        },
        { status: 409 }
      );
    }
    const mode = await setAiBehaviorOptimizationMode(
      supabaseAdmin(),
      accountId,
      enabled ? 'on' : 'off'
    );
    return NextResponse.json({ ai_behavior_optimization: mode });
  } catch (err) {
    return toErrorResponse(err);
  }
}
