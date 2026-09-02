import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { canSpeak, canTranscribe, synthesizeSpeech } from '@/lib/ai/speech'
import { GREETING_FALLBACK } from '@/lib/calling/live-ai-turn'

export const maxDuration = 30

/**
 * POST /api/calling/live-ai/warmup  (agent+)
 *
 * Compiles speech + turn modules and caches a greeting MP3 so the first
 * inbound call is not silent while Next.js compiles `/live-ai/turn`.
 */
export async function POST() {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limited = checkRateLimit(`live-ai-warmup:${userId}`, RATE_LIMITS.liveAiTurn)
    if (!limited.success) return rateLimitResponse(limited)

    const config = await loadAiConfig(supabaseAdmin(), accountId)
    if (!config || !canTranscribe(config) || !canSpeak(config)) {
      return NextResponse.json(
        { error: 'Live AI is not configured', code: 'live_ai_not_ready' },
        { status: 400 },
      )
    }

    const spoken = await synthesizeSpeech({
      config,
      text: GREETING_FALLBACK,
      whatsapp: false,
    })
    return NextResponse.json({
      reply: GREETING_FALLBACK,
      audioBase64: Buffer.from(spoken.bytes).toString('base64'),
      mimeType: spoken.mimeType,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
