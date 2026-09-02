import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  executeLiveAiTool,
  parseToolArguments,
  persistLiveAiTranscript,
} from '@/lib/calling/live-ai-tool'

export const maxDuration = 30

function httpError(err: unknown): NextResponse | null {
  if (!err || typeof err !== 'object') return null
  const status = (err as { status?: number }).status
  const code = (err as { code?: string }).code
  const message = err instanceof Error ? err.message : 'Tool failed'
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
 * POST /api/calling/live-ai/tool  (agent+)
 *
 * Execute a Realtime function tool or persist a spoken transcript.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limited = checkRateLimit(`live-ai-tool:${userId}`, RATE_LIMITS.liveAiTool)
    if (!limited.success) return rateLimitResponse(limited)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const callId = typeof body?.callId === 'string' ? body.callId.trim() : ''
    if (!callId) {
      return NextResponse.json({ error: 'callId is required.' }, { status: 400 })
    }

    const type = body?.type === 'transcript' ? 'transcript' : 'tool'
    if (type === 'transcript') {
      const role = body?.role === 'bot' ? 'bot' : body?.role === 'customer' ? 'customer' : null
      const text = typeof body?.text === 'string' ? body.text : ''
      if (!role || !text.trim()) {
        return NextResponse.json({ error: 'role and text are required.' }, { status: 400 })
      }
      const itemId = typeof body?.itemId === 'string' ? body.itemId : undefined
      const result = await persistLiveAiTranscript({
        accountId,
        callId,
        role,
        text,
        itemId,
      })
      return NextResponse.json(result)
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    }
    const result = await executeLiveAiTool({
      accountId,
      userId,
      callId,
      name,
      arguments: parseToolArguments(body?.arguments ?? body?.args),
    })
    return NextResponse.json(result)
  } catch (err) {
    const mapped = httpError(err)
    if (mapped) return mapped
    return toErrorResponse(err)
  }
}
