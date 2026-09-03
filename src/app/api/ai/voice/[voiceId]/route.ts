import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { requirePlatformElevenLabsKey } from '@/lib/ai/platform-settings'
import {
  deleteVoice,
  editVoice,
  getVoiceSettings,
  updateVoiceSettings,
  CLONE_MAX_BYTES,
} from '@/lib/elevenlabs/voices'
import {
  isAllowedSttMime,
  normalizeAudioMime,
  extensionForAudioMime,
} from '@/lib/elevenlabs/limits'
import { AiError } from '@/lib/ai/types'

async function elevenLabsKey(): Promise<
  { ok: true; apiKey: string } | { ok: false; response: NextResponse }
> {
  const key = await requirePlatformElevenLabsKey()
  if (!key.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: key.error, code: key.code }, { status: 400 }),
    }
  }
  return { ok: true, apiKey: key.apiKey }
}

/**
 * GET /api/ai/voice/[voiceId]  (admin+) — voice settings
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ voiceId: string }> },
) {
  try {
    await requireRole('admin')
    const { voiceId } = await context.params
    const key = await elevenLabsKey()
    if (!key.ok) return key.response
    const settings = await getVoiceSettings(key.apiKey, voiceId)
    return NextResponse.json({ settings })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/voice/[voiceId]  (admin+)
 *
 * JSON: { stability, similarity_boost } and/or multipart extra samples.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ voiceId: string }> },
) {
  try {
    const { userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-voice-edit:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { voiceId } = await context.params
    const key = await elevenLabsKey()
    if (!key.ok) return key.response

    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const blobs = form.getAll('files').filter((v): v is File => v instanceof File)
      const files: Array<{ bytes: Uint8Array; mimeType: string; fileName: string }> =
        []
      for (const blob of blobs) {
        if (blob.size > CLONE_MAX_BYTES) {
          return NextResponse.json(
            { error: 'An audio sample is too large.' },
            { status: 400 },
          )
        }
        const mime = normalizeAudioMime(blob.type) ?? 'audio/webm'
        if (!isAllowedSttMime(mime)) {
          return NextResponse.json(
            { error: `Unsupported audio type: ${mime}` },
            { status: 400 },
          )
        }
        files.push({
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mimeType: mime,
          fileName:
            blob instanceof File && blob.name
              ? blob.name
              : `sample.${extensionForAudioMime(mime)}`,
        })
      }
      const name =
        typeof form.get('name') === 'string' ? String(form.get('name')) : undefined
      await editVoice({
        apiKey: key.apiKey,
        voiceId,
        name,
        files: files.length ? files : undefined,
      })
      return NextResponse.json({ ok: true })
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const stability = Number(body.stability)
    const similarityBoost = Number(body.similarity_boost ?? body.similarityBoost)
    if (!Number.isFinite(stability) || !Number.isFinite(similarityBoost)) {
      return NextResponse.json(
        { error: 'stability and similarity_boost are required.' },
        { status: 400 },
      )
    }
    await updateVoiceSettings(key.apiKey, voiceId, {
      stability: Math.min(1, Math.max(0, stability)),
      similarityBoost: Math.min(1, Math.max(0, similarityBoost)),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/voice/[voiceId]  (admin+)
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ voiceId: string }> },
) {
  try {
    const { userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-voice-delete:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { voiceId } = await context.params
    const key = await elevenLabsKey()
    if (!key.ok) return key.response
    await deleteVoice(key.apiKey, voiceId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
