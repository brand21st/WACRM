import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  accountIdFromRazorpayNotes,
  receiptFromRazorpayPayload,
  verifyRazorpayWebhookSignature,
} from '@/lib/commerce/razorpay'
import { loadCommerceSecrets } from '@/lib/shopify/commerce-config'
import { handleWhatsAppPaymentStatus } from '@/lib/commerce/payment'

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * POST /api/commerce/razorpay/webhook
 *
 * Optional merchant Razorpay webhook for reconciliation only.
 * WhatsApp Payments still require the Meta payment status + lookup.
 * Never uses WACRM SaaS billing Razorpay keys.
 */
export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-razorpay-signature')
  let parsed: unknown
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const receipt = receiptFromRazorpayPayload(parsed)
  const accountFromNotes = accountIdFromRazorpayNotes(
    (parsed as { payload?: { payment?: { entity?: { notes?: unknown } } } } | null)
      ?.payload?.payment?.entity?.notes,
  )

  const db = supabaseAdmin()
  let accountId = accountFromNotes
  if (!accountId && receipt) {
    const { data } = await db
      .from('whatsapp_commerce_orders')
      .select('account_id')
      .eq('reference_id', receipt)
      .maybeSingle()
    accountId = typeof data?.account_id === 'string' ? data.account_id : null
  }
  if (!accountId) {
    return NextResponse.json({ ok: true, ignored: true })
  }

  const secrets = await loadCommerceSecrets(db, accountId)
  if (!secrets.razorpayWebhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 400 })
  }
  if (
    !verifyRazorpayWebhookSignature(
      rawBody,
      signature,
      secrets.razorpayWebhookSecret,
    )
  ) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (receipt) {
    const { data: wa } = await db
      .from('whatsapp_config')
      .select('phone_number_id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (wa?.phone_number_id) {
      await handleWhatsAppPaymentStatus({
        db,
        phoneNumberId: String(wa.phone_number_id),
        status: {
          type: 'payment',
          status: 'captured',
          payment: { reference_id: receipt },
        },
      })
    }
  }

  return NextResponse.json({ ok: true })
}
