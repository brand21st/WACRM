import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainVoiceInboundJobs } from '@/lib/ai/voice-inbound-jobs'

/**
 * Drain queued inbound voice notes (STT + spoken auto-reply).
 * Same `x-cron-secret` / `AUTOMATION_CRON_SECRET` as automations,
 * flows, broadcasts, and Shopify notifications.
 *
 * Hit this every 10–30s so overlapping customers get a reply without
 * holding Meta's webhook open for transcription.
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
    const result = await drainVoiceInboundJobs(supabaseAdmin(), 20)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[voice/cron]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
