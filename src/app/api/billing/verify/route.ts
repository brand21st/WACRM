import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { verifyCheckoutSignature } from '@/lib/billing/razorpay'

export async function POST(request: Request) {
  try {
    await requireRole('admin')
    const body = (await request.json().catch(() => null)) as {
      razorpay_subscription_id?: string
      razorpay_payment_id?: string
      razorpay_signature?: string
    } | null
    const subscriptionId = body?.razorpay_subscription_id ?? ''
    const paymentId = body?.razorpay_payment_id ?? ''
    const signature = body?.razorpay_signature ?? ''
    if (!subscriptionId || !paymentId || !signature) {
      return NextResponse.json({ error: 'Missing checkout fields' }, { status: 400 })
    }
    const ok = await verifyCheckoutSignature({ subscriptionId, paymentId, signature })
    if (!ok) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
    return NextResponse.json({ verified: true, pending: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
