import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { runBillingSweep } from '@/lib/billing/sweep'

/**
 * Sweep every account subscription against its package interval.
 * Complimentary paid plans renew for the next month / 3 months / year.
 * Cancelled, past-due, and checkout periods that ended are expired.
 *
 * Same `x-cron-secret` / `AUTOMATION_CRON_SECRET` as the other drains.
 * Hit daily (or hourly) so 3-month and yearly packages stay in sync.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runBillingSweep(supabaseAdmin())
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[billing/cron]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
