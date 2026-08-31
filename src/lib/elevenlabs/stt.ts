import { AiError } from '@/lib/ai/types'
import { elevenLabsHttpError, toElevenLabsNetworkError } from './errors'
import {
  extensionForAudioMime,
  elevenLabsTimeoutMs,
  isAllowedSttMime,
  normalizeAudioMime,
  STT_MAX_BYTES,
} from './limits'

export const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text'
export const ELEVENLABS_STT_MODEL = 'scribe_v2'

export interface SpeechToTextArgs {
  apiKey: string
  audio: Uint8Array | ArrayBuffer | Buffer
  mimeType: string
  fileName?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * Batch speech-to-text via ElevenLabs Scribe v2.
 *
 * Multipart POST to `/v1/speech-to-text`. Throws `AiError` on invalid
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
  form.append('model_id', ELEVENLABS_STT_MODEL)
  form.append(
    'file',
    new Blob([Buffer.from(bytes)], { type: mime! }),
    fileName,
  )

  const timeoutMs = args.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(ELEVENLABS_STT_URL, {
      method: 'POST',
      headers: { 'xi-api-key': args.apiKey },
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }

  if (!res.ok) throw await elevenLabsHttpError(res)

  const body = (await res.json()) as { text?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  return text
}
