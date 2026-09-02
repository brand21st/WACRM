import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { CallActionError, terminateCall } from '@/lib/whatsapp/call-actions'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`calls:${userId}`, RATE_LIMITS.callAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { id } = await context.params
    const call = await terminateCall({ accountId, userId, callId: id })
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
