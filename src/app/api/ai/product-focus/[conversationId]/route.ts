import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  clearProductFocus,
  parseProductFocus,
  productFocusFromMessage,
  saveProductFocus,
  shouldClearDraftFocus,
} from '@/lib/shopify/product-focus'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/product-focus/[conversationId]  (agent+)
 *
 * Pin or clear the Shopify product the inbox agent selected as a reply
 * target so Draft with AI and auto-reply stay scoped to that product.
 *
 * Body:
 *   { message_id } — set focus from that thread message
 *   { clear: true, message_id? } — drop a reply-draft pin only
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limit = checkRateLimit(`ai-product-focus:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, ai_product_focus')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/product-focus] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    if (body.clear === true) {
      const dismissedId =
        typeof body.message_id === 'string' ? body.message_id.trim() : ''
      const current = parseProductFocus(conv.ai_product_focus)
      if (!dismissedId || shouldClearDraftFocus(current, dismissedId)) {
        await clearProductFocus(supabase, conversationId)
      }
      return NextResponse.json({ success: true, cleared: true })
    }

    const messageId =
      typeof body.message_id === 'string' ? body.message_id.trim() : ''
    if (!messageId) {
      return NextResponse.json({ error: 'message_id is required' }, { status: 400 })
    }

    const { data: message, error: msgErr } = await supabase
      .from('messages')
      .select('id, content_type, content_text, interactive_payload')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .maybeSingle()
    if (msgErr) {
      console.error('[ai/product-focus] message lookup error:', msgErr)
      return NextResponse.json({ error: 'Failed to load message' }, { status: 500 })
    }
    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const extracted = productFocusFromMessage(message)
    if (!extracted) {
      return NextResponse.json({ success: true, focused: false })
    }

    await saveProductFocus(supabase, conversationId, {
      ...extracted,
      stage: 'focused',
      setBy: 'reply_draft',
    })
    return NextResponse.json({
      success: true,
      focused: true,
      handle: extracted.handle,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
