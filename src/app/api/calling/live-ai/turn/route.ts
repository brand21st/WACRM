import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { runLiveAiTurn, type LiveAiTurnKind } from '@/lib/calling/live-ai-turn'
import {
  isAllowedSttMime,
  normalizeAudioMime,
  STT_MAX_BYTES,
} from '@/lib/elevenlabs/limits'

export const maxDuration = 60

function httpError(err: unknown): NextResponse | null {
  if (!err || typeof err !== 'object') return null
  const status = (err as { status?: number }).status
  const code = (err as { code?: string }).code
  const message = err instanceof Error ? err.message : 'Turn failed'
  if (typeof status === 'number' && status >= 400 && status < 600) {
    return NextResponse.json({ error: message, code }, { status })
  }
  return null
}

/**
 * POST /api/calling/live-ai/turn  (agent+)
 *
 * One spoken turn for an AI-answered WhatsApp call: greeting (no audio)
 * or utterance (multipart audio). Returns TTS mp3 plus inbox-mirrored text.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const userLimit = checkRateLimit(`live-ai-turn:${userId}`, RATE_LIMITS.liveAiTurn)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `live-ai-turn-acct:${accountId}`,
      RATE_LIMITS.liveAiTurnAccount,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 })
    }

    const callId = String(form.get('callId') ?? '').trim()
    if (!callId) {
      return NextResponse.json({ error: 'callId is required.' }, { status: 400 })
    }

    const kindRaw = String(form.get('kind') ?? 'utterance').trim()
    const kind: LiveAiTurnKind = kindRaw === 'greeting' ? 'greeting' : 'utterance'

    let audio: { bytes: Buffer; mimeType: string; fileName: string } | undefined
    const audioField = form.get('file') ?? form.get('audio')
    if (audioField instanceof Blob && audioField.size > 0) {
      if (audioField.size > STT_MAX_BYTES) {
        return NextResponse.json({ error: 'Audio is too large.' }, { status: 400 })
      }
      const mime = normalizeAudioMime(audioField.type) ?? 'audio/webm'
      if (!isAllowedSttMime(mime)) {
        return NextResponse.json(
          { error: `Unsupported audio type: ${mime}` },
          { status: 400 },
        )
      }
      const buf = Buffer.from(await audioField.arrayBuffer())
      audio = {
        bytes: buf,
        mimeType: mime,
        fileName: audioField instanceof File && audioField.name ? audioField.name : 'utterance.webm',
      }
    } else if (kind === 'utterance') {
      return NextResponse.json({ error: 'audio is required.' }, { status: 400 })
    }

    const persistOnly = String(form.get('persistOnly') ?? '') === '1'
    const spokenReply = String(form.get('reply') ?? '').trim()

    const result = await runLiveAiTurn({
      accountId,
      userId,
      callId,
      kind,
      audio,
      persistOnly,
      spokenReply: spokenReply || undefined,
    })
    return NextResponse.json(result)
  } catch (err) {
    const mapped = httpError(err)
    if (mapped) return mapped
    return toErrorResponse(err)
  }
}
