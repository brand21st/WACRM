import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  AiBehaviorAdminError,
  rollbackAiBehaviorExperiment,
} from '@/lib/ai/intelligence/ai-behavior-admin'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `ai-behavior-rollback:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    await rollbackAiBehaviorExperiment(supabaseAdmin(), accountId, id)
    return NextResponse.json({ ok: true, id, status: 'rolled_back' })
  } catch (err) {
    if (err instanceof AiBehaviorAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
