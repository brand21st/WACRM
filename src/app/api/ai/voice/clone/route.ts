import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { requirePlatformElevenLabsKey } from '@/lib/ai/platform-settings'
import { addVoice, CLONE_MAX_FILES, CLONE_MAX_BYTES } from '@/lib/elevenlabs/voices'
import {
  isAllowedSttMime,
  normalizeAudioMime,
  extensionForAudioMime,
} from '@/lib/elevenlabs/limits'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/voice/clone  (admin+)
 *
 * Instant Voice Clone via ElevenLabs. Multipart: `name`, optional
 * `description`, and one or more `files`. Samples are forwarded and
 * not persisted.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')

    const userLimit = checkRateLimit(`ai-voice-clone:${userId}`, RATE_LIMITS.adminAction)
    if (!userLimit.success) return rateLimitResponse(userLimit)
    const acctLimit = checkRateLimit(
      `ai-voice-clone-acct:${accountId}`,
      RATE_LIMITS.aiVoiceClone,
    )
    if (!acctLimit.success) return rateLimitResponse(acctLimit)

    const key = await requirePlatformElevenLabsKey()
    if (!key.ok) {
      return NextResponse.json({ error: key.error, code: key.code }, { status: 400 })
    }
    const apiKey = key.apiKey

    const form = await request.formData().catch(() => null)
    if (!form) {
      return NextResponse.json({ error: 'Expected multipart form data.' }, { status: 400 })
    }
    const name = typeof form.get('name') === 'string' ? String(form.get('name')) : ''
    const description =
      typeof form.get('description') === 'string'
        ? String(form.get('description'))
        : ''

    const blobs = form.getAll('files').filter((v): v is File => v instanceof File)
    if (blobs.length === 0) {
      const single = form.get('file')
      if (single instanceof File) blobs.push(single)
    }
    if (blobs.length > CLONE_MAX_FILES) {
      return NextResponse.json(
        { error: `At most ${CLONE_MAX_FILES} samples.` },
        { status: 400 },
      )
    }

    const files: Array<{ bytes: Uint8Array; mimeType: string; fileName: string }> = []
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
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const fileName =
        blob instanceof File && blob.name
          ? blob.name
          : `sample.${extensionForAudioMime(mime)}`
      files.push({ bytes, mimeType: mime, fileName })
    }

    const { voiceId } = await addVoice({
      apiKey,
      name,
      description: description || undefined,
      files,
    })
    return NextResponse.json({ voice_id: voiceId })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status === 502 ? 400 : err.status },
      )
    }
    return toErrorResponse(err)
  }
}
