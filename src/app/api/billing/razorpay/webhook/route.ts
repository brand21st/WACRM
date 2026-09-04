import { NextResponse } from 'next/server'

import { fulfillRazorpayEvent, recordWebhookEvent } from '@/lib/billing/fulfillment'
import { verifyWebhookSignature } from '@/lib/billing/razorpay'

export async function POST(request: Request) {
  const raw = await request.text()
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  if (!(await verifyWebhookSignature(raw, signature))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let payload: {
    event?: string
    id?: string
    payload?: unknown
  }
  try {
    payload = JSON.parse(raw) as typeof payload
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = payload.event ?? ''
  const eventId = payload.id ?? `${eventType}:${signature.slice(0, 24)}`
  try {
    const inserted = await recordWebhookEvent(eventId, eventType, payload)
    if (inserted) {
      await fulfillRazorpayEvent(eventType, payload)
    }
  } catch (err) {
    console.error('[billing webhook] fulfill failed:', err)
    return NextResponse.json({ error: 'Fulfillment failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
