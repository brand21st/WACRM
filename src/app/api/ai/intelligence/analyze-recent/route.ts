import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  ANALYZE_RECENT_CONFIRMATION,
  clampAnalyzeBatchSize,
  clampAnalyzeWindowDays,
  enqueueBoundedConversationAnalyze,
  previewBoundedConversationAnalyze,
} from '@/lib/ai/intelligence/enqueue-bounded-analyze'

function parseBounds(input: Record<string, unknown> | URLSearchParams) {
  const windowRaw =
    input instanceof URLSearchParams
      ? input.get('windowDays')
      : input.windowDays
  const batchRaw =
    input instanceof URLSearchParams
      ? input.get('maxConversations')
      : input.maxConversations
  return {
    windowDays: clampAnalyzeWindowDays(windowRaw),
    maxConversations: clampAnalyzeBatchSize(batchRaw),
  }
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const bounds = parseBounds(new URL(request.url).searchParams)
    const preview = await previewBoundedConversationAnalyze(
      supabaseAdmin(),
      accountId,
      bounds,
    )
    return NextResponse.json(preview, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    if (body.accountId != null) {
      return NextResponse.json(
        { error: 'accountId cannot be supplied by the client' },
        { status: 400 },
      )
    }
    if (body.confirmation !== ANALYZE_RECENT_CONFIRMATION) {
      return NextResponse.json(
        { error: 'Bounded analysis requires explicit confirmation' },
        { status: 400 },
      )
    }
    const bounds = parseBounds(body)
    const result = await enqueueBoundedConversationAnalyze(
      supabaseAdmin(),
      accountId,
      bounds,
    )
    return NextResponse.json(result)
  } catch (err) {
    return toErrorResponse(err)
  }
}
