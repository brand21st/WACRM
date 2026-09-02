import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { speakLiveAiUtterance } from '@/lib/calling/live-ai-realtime'

export const maxDuration = 30

function httpError(err: unknown): NextResponse | null {
  if (!err || typeof err !== 'object') return null
  const status = (err as { status?: number }).status
  const code = (err as { code?: string }).code
  const message = err instanceof Error ? err.message : 'Speak failed'
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return NextResponse.json({ error: message, code }, { status })
  }
  return null
}

/** Compile this route in dev before an inbound call. */
export async function GET() {
  try {
    await requireRole('agent')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/calling/live-ai/speak  (agent+)
 *
 * Synthesize one live-call utterance with the Voice Agent TTS voice.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const userLimit = checkRateLimit(`live-ai-speak:${userId}`, RATE_LIMITS.liveAiTurn)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `live-ai-speak-acct:${accountId}`,
      RATE_LIMITS.liveAiTurnAccount,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = (await request.json().catch(() => null)) as {
      callId?: unknown
      text?: unknown
    } | null
    const callId = typeof body?.callId === 'string' ? body.callId.trim() : ''
    const text = typeof body?.text === 'string' ? body.text : ''
    if (!callId) {
      return NextResponse.json({ error: 'callId is required.' }, { status: 400 })
    }
    if (!text.trim()) {
      return NextResponse.json({ error: 'text is required.' }, { status: 400 })
    }

    const result = await speakLiveAiUtterance({ accountId, callId, text })
    return NextResponse.json(result)
  } catch (err) {
    const mapped = httpError(err)
    if (mapped) return mapped
    return toErrorResponse(err)
  }
}
