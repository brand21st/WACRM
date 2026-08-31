import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainShopifyNotificationJobs } from '@/lib/shopify/notifications'

/**
 * Drain due Shopify notification jobs (abandoned checkout wait,
 * N days after delivered). Same `x-cron-secret` /
 * `AUTOMATION_CRON_SECRET` as automations and flows.
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
    const result = await drainShopifyNotificationJobs(supabaseAdmin(), 50)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[shopify/notifications/cron]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
