import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  AiBehaviorAdminError,
  createAiBehaviorExperiment,
} from '@/lib/ai/intelligence/ai-behavior-admin'

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const { data, error } = await supabaseAdmin()
      .from('ai_behavior_experiments')
      .select(
        'id, account_id, name, objective, control_version_id, variant_version_id, control_was_implicit, variant_allocation, status, started_at, ended_at, evaluation, candidate_winner_version_id, created_at, updated_at',
      )
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
    if (error) {
      console.error('[ai/behavior-experiments GET]', error)
      return NextResponse.json({ error: 'Failed to load experiments' }, { status: 500 })
    }
    return NextResponse.json({ experiments: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `ai-behavior-create:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const created = await createAiBehaviorExperiment(supabaseAdmin(), {
      accountId,
      name: typeof body.name === 'string' ? body.name : '',
      objective: typeof body.objective === 'string' ? body.objective : '',
      variantBehavior: body.behavior ?? body.variant_behavior,
      variantAllocation:
        typeof body.variant_allocation === 'number'
          ? body.variant_allocation
          : undefined,
      createdBy: userId,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (err) {
    if (err instanceof AiBehaviorAdminError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
