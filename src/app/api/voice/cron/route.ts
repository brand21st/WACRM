import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { drainVoiceInboundJobs } from '@/lib/ai/voice-inbound-jobs'

/**
 * Optional fallback drain for inbound voice notes when Redis/BullMQ
 * is down. Primary path is the `wacrm-worker` process (`ai-voice-inbound`).
 * Same `x-cron-secret` / `AUTOMATION_CRON_SECRET` as automations.
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
