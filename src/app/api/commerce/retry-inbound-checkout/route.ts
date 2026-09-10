import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { handleInboundWhatsAppOrder } from '@/lib/commerce/checkout'
import { webhookMessageFromInboundCart } from '@/lib/commerce/inbound-order'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

/**
 * POST /api/commerce/retry-inbound-checkout  (agent+)
 *
 * Replay a stored WhatsApp catalog cart through checkout. Live phone
 * carts hit the production webhook, so localhost / already-saved carts
 * never send View cart + Checkout NOW unless we run this path.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const { assertWhatsAppSend } = await import('@/lib/billing/entitlements')
    await assertWhatsAppSend(accountId)

    const limit = checkRateLimit(
      `retry-inbound-checkout:${userId}`,
      RATE_LIMITS.send,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const conversationId =
      body && typeof body.conversation_id === 'string'
        ? body.conversation_id.trim()
        : ''
    const messageId =
      body && typeof body.message_id === 'string' ? body.message_id.trim() : ''
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()
    const { data: conversation, error: convError } = await db
      .from('conversations')
      .select('id, contact_id, account_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convError) throw convError
    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }

    let query = db
      .from('messages')
      .select('id, interactive_payload, content_type')
      .eq('conversation_id', conversationId)
      .eq('content_type', 'order')
      .order('created_at', { ascending: false })
      .limit(1)
    if (messageId) {
      query = db
        .from('messages')
        .select('id, interactive_payload, content_type')
        .eq('id', messageId)
        .eq('conversation_id', conversationId)
        .eq('content_type', 'order')
        .limit(1)
    }
    const { data: rows, error: msgError } = await query
    if (msgError) throw msgError
    const message = rows?.[0]
    const payload = message?.interactive_payload
    if (
      !payload ||
      typeof payload !== 'object' ||
      (payload as { kind?: string }).kind !== 'inbound_order' ||
      !Array.isArray((payload as { items?: unknown }).items)
    ) {
      return NextResponse.json(
        { error: 'No WhatsApp cart message to check out' },
        { status: 404 },
      )
    }

    const { data: contact, error: contactError } = await db
      .from('contacts')
      .select('id, phone, name')
      .eq('id', conversation.contact_id)
      .maybeSingle()
    if (contactError) throw contactError
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const cart = payload as {
      catalog_id?: string
      items: Array<{
        product_retailer_id: string
        quantity: number
        item_price?: number
        currency?: string
        name?: string
      }>
    }
    const result = await handleInboundWhatsAppOrder({
      db,
      accountId,
      userId,
      conversationId,
      contactId: contact.id,
      contactPhone: contact.phone ?? null,
      contactName: contact.name ?? null,
      message: webhookMessageFromInboundCart(cart),
    })

    if (result === 'skipped') {
      return NextResponse.json(
        { error: 'Could not send checkout for this cart', result },
        { status: 422 },
      )
    }

    return NextResponse.json({ ok: true, result })
  } catch (err) {
    return toErrorResponse(err)
  }
}
