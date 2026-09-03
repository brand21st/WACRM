import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { CRON_BATCH, drainChatMemoryJobs } from '@/lib/ai/chat-memory'

/**
 * Summarize idle / overflow WhatsApp threads into contact_ai_memory.
 * Same `x-cron-secret` / `AUTOMATION_CRON_SECRET` as other crons.
 *
 * Hit every few minutes so the next inbound still knows what the
 * customer already asked for.
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
    const result = await drainChatMemoryJobs(supabaseAdmin(), CRON_BATCH)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/memory/cron]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
