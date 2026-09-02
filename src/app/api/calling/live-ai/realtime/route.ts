import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { startLiveAiRealtimeCall } from '@/lib/calling/live-ai-realtime'

export const maxDuration = 30

function httpError(err: unknown): NextResponse | null {
  if (!err || typeof err !== 'object') return null
  const status = (err as { status?: number }).status
  const code = (err as { code?: string }).code
  const message = err instanceof Error ? err.message : 'Realtime session failed'
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
 * POST /api/calling/live-ai/realtime  (agent+)
 *
 * Proxy the browser's OpenAI Realtime WebRTC offer SDP. Media then
 * flows browser ↔ OpenAI; this request is only the SDP handshake.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const userLimit = checkRateLimit(`live-ai-realtime:${userId}`, RATE_LIMITS.liveAiRealtime)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `live-ai-realtime-acct:${accountId}`,
      RATE_LIMITS.liveAiRealtimeAccount,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const body = (await request.json().catch(() => null)) as {
      callId?: unknown
      sdp?: unknown
    } | null
    const callId = typeof body?.callId === 'string' ? body.callId.trim() : ''
    const sdp = typeof body?.sdp === 'string' ? body.sdp.trim() : ''
    if (!callId) {
      return NextResponse.json({ error: 'callId is required.' }, { status: 400 })
    }
    if (!sdp.startsWith('v=')) {
      return NextResponse.json({ error: 'sdp offer is required.' }, { status: 400 })
    }

    const result = await startLiveAiRealtimeCall({ accountId, callId, sdp })
    return NextResponse.json(result)
  } catch (err) {
    const mapped = httpError(err)
    if (mapped) return mapped
    return toErrorResponse(err)
  }
}
