import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { canLiveAiRealtime, LIVE_AI_NOT_READY_MESSAGE } from '@/lib/calling/live-ai-ready'

export const maxDuration = 30

/**
 * POST /api/calling/live-ai/warmup  (agent+)
 *
 * Compiles Realtime + tool modules so the first inbound call is not
 * silent while Next.js compiles `/live-ai/realtime`.
 */
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limited = checkRateLimit(`live-ai-warmup:${userId}`, RATE_LIMITS.liveAiTurn)
    if (!limited.success) return rateLimitResponse(limited)

    await Promise.all([
      import('@/lib/calling/live-ai-realtime'),
      import('@/lib/calling/live-ai-tool'),
    ])

    const config = await loadAiConfig(supabaseAdmin(), accountId)
    if (!canLiveAiRealtime(config)) {
      return NextResponse.json(
        { error: LIVE_AI_NOT_READY_MESSAGE, code: 'live_ai_not_ready' },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
