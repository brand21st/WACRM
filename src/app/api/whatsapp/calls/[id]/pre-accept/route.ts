import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  CallActionError,
  preAcceptCall,
} from '@/lib/whatsapp/call-actions'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`calls:${userId}`, RATE_LIMITS.callAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as {
      sdp?: string
      aiAnswered?: boolean
    }
    const sdp = typeof body.sdp === 'string' ? body.sdp : ''

    const call = await preAcceptCall({
      accountId,
      userId,
      callId: id,
      sdp,
      aiAnswered: body.aiAnswered === true,
    })
    const { sdp_offer: _omit, ...rest } = call
    return NextResponse.json({ call: rest })
  } catch (err) {
    if (err instanceof CallActionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
