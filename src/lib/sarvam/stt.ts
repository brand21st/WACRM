import { AiError } from '@/lib/ai/types'
import { sarvamHttpError, toSarvamNetworkError } from './errors'
import {
  SARVAM_STT_MODEL,
  SARVAM_STT_URL,
  sarvamTimeoutMs,
} from './limits'
import {
  extensionForAudioMime,
  isAllowedSttMime,
  normalizeAudioMime,
  STT_MAX_BYTES,
} from '@/lib/elevenlabs/limits'

export interface SpeechToTextArgs {
  apiKey: string
  audio: Uint8Array | ArrayBuffer | Buffer
  mimeType: string
  fileName?: string
  /** BCP-47 code, or `unknown` to auto-detect. */
  languageCode?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * Batch speech-to-text via Sarvam Saaras v3.
 *
 * Multipart POST to `/speech-to-text`. Throws `AiError` on invalid
 * input, auth failure, rate limit, timeout, or any other provider
 * error. Returns the transcript text (possibly empty).
 */
export async function speechToText(args: SpeechToTextArgs): Promise<string> {
  const mime = normalizeAudioMime(args.mimeType)
  if (!isAllowedSttMime(mime)) {
    throw new AiError(
      `Unsupported audio type for transcription${mime ? `: ${mime}` : ''}.`,
      { code: 'unsupported_audio', status: 400 },
    )
  }

  const bytes =
    args.audio instanceof Uint8Array
      ? args.audio
      : new Uint8Array(args.audio)
  if (bytes.byteLength === 0) {
    throw new AiError('Audio is empty.', {
      code: 'empty_audio',
      status: 400,
    })
  }
  if (bytes.byteLength > STT_MAX_BYTES) {
    throw new AiError(
      `Audio is too large (${bytes.byteLength} bytes). Maximum is ${STT_MAX_BYTES}.`,
      { code: 'audio_too_large', status: 400 },
    )
  }

  const fileName =
    args.fileName?.trim() || `audio.${extensionForAudioMime(mime!)}`
  const form = new FormData()
  form.append('model', SARVAM_STT_MODEL)
  form.append(
    'file',
    new Blob([Buffer.from(bytes)], { type: mime! }),
    fileName,
  )
  const language = args.languageCode?.trim()
  if (language) form.append('language_code', language)

  const timeoutMs = args.timeoutMs ?? sarvamTimeoutMs()
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(SARVAM_STT_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': args.apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toSarvamNetworkError(err)
  }

  if (!res.ok) throw await sarvamHttpError(res)

  const body = (await res.json()) as { transcript?: unknown }
  const text = typeof body.transcript === 'string' ? body.transcript.trim() : ''
  return text
}
