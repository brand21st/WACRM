import { NextResponse, type NextRequest } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendMessageOnPageChannel } from '@/lib/meta/page-send'
import { mobileCorsOptionsResponse, withMobileCors } from '@/lib/http/mobile-cors'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { SendMessageError } from '@/lib/whatsapp/send-message'

export async function OPTIONS(request: NextRequest) {
  return mobileCorsOptionsResponse(request) ?? new NextResponse(null, { status: 405 })
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const { assertWhatsAppSend } = await import('@/lib/billing/entitlements')
    await assertWhatsAppSend(accountId)

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return withMobileCors(request, rateLimitResponse(limit))
    }

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return withMobileCors(
        request,
        NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 }),
      )
    }

    const conversationId =
      typeof body.conversation_id === 'string' ? body.conversation_id : ''
    const messageType =
      typeof body.message_type === 'string' ? body.message_type : ''
    if (!conversationId || !messageType) {
      return withMobileCors(
        request,
        NextResponse.json(
          { error: 'conversation_id and message_type are required' },
          { status: 400 },
        ),
      )
    }

    const allowed = ['text', 'image', 'video', 'audio', 'document'] as const
    if (!(allowed as readonly string[]).includes(messageType)) {
      return withMobileCors(
        request,
        NextResponse.json(
          { error: `Unsupported message_type "${messageType}"` },
          { status: 400 },
        ),
      )
    }

    let replyToMid: string | null = null
    const replyToMessageId =
      typeof body.reply_to_message_id === 'string'
        ? body.reply_to_message_id
        : null
    if (replyToMessageId) {
      const { data: parent } = await supabase
        .from('messages')
        .select('message_id')
        .eq('id', replyToMessageId)
        .eq('conversation_id', conversationId)
        .maybeSingle()
      replyToMid = parent?.message_id ?? null
    }

    const result = await sendMessageOnPageChannel(supabase, accountId, {
      conversationId,
      messageType: messageType as (typeof allowed)[number],
      contentText:
        typeof body.content_text === 'string' ? body.content_text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      replyToMessageId,
      replyToMid,
    })

    return withMobileCors(
      request,
      NextResponse.json({
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
      }),
    )
  } catch (err) {
    if (err instanceof SendMessageError) {
      return withMobileCors(
        request,
        NextResponse.json({ error: err.message, code: err.code }, { status: err.status }),
      )
    }
    return withMobileCors(request, toErrorResponse(err))
  }
}
