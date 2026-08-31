import { AiError } from '@/lib/ai/types'
import { sarvamHttpError, toSarvamNetworkError } from './errors'
import {
  SARVAM_PREVIEW_CODEC,
  SARVAM_TTS_MAX_CHARS,
  SARVAM_TTS_MIME_MP3,
  SARVAM_TTS_MIME_OPUS,
  SARVAM_TTS_MIME_WAV,
  SARVAM_TTS_MODEL,
  SARVAM_TTS_URL,
  SARVAM_WHATSAPP_CODEC,
  SARVAM_WHATSAPP_SAMPLE_RATE,
  sarvamTimeoutMs,
} from './limits'
import { DEFAULT_SARVAM_LANGUAGE, DEFAULT_SARVAM_SPEAKER } from '@/lib/ai/voice'

export interface TextToSpeechArgs {
  apiKey: string
  text: string
  speaker?: string
  languageCode?: string
  pace?: number
  temperature?: number
  /** `opus` for WhatsApp voice notes, `mp3` for browser preview. */
  outputAudioCodec?: 'opus' | 'mp3' | 'wav'
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface TextToSpeechResult {
  bytes: Uint8Array
  mimeType: string
}

/**
 * Text-to-speech via Sarvam Bulbul v3.
 *
 * POST `/text-to-speech` with JSON. Returns decoded audio bytes from
 * the first base64 `audios[]` entry.
 */
export async function textToSpeech(
  args: TextToSpeechArgs,
): Promise<TextToSpeechResult> {
  const text = args.text.trim()
  if (!text) {
    throw new AiError('Nothing to speak.', {
      code: 'empty_text',
      status: 400,
    })
  }
  if (text.length > SARVAM_TTS_MAX_CHARS) {
    throw new AiError(
      `Text is too long for speech (${text.length} characters). Maximum is ${SARVAM_TTS_MAX_CHARS}.`,
      { code: 'text_too_long', status: 400 },
    )
  }

  const speaker = args.speaker?.trim() || DEFAULT_SARVAM_SPEAKER
  const languageCode = args.languageCode?.trim() || DEFAULT_SARVAM_LANGUAGE
  const codec = args.outputAudioCodec ?? SARVAM_PREVIEW_CODEC

  const timeoutMs = args.timeoutMs ?? sarvamTimeoutMs()
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(SARVAM_TTS_URL, {
      method: 'POST',
      headers: {
        'api-subscription-key': args.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model: SARVAM_TTS_MODEL,
        speaker,
        language_code: languageCode,
        output_audio_codec: codec,
        ...(codec === SARVAM_WHATSAPP_CODEC
          ? { speech_sample_rate: SARVAM_WHATSAPP_SAMPLE_RATE }
          : {}),
        ...(args.pace != null ? { pace: args.pace } : {}),
        ...(args.temperature != null ? { temperature: args.temperature } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toSarvamNetworkError(err)
  }

  if (!res.ok) throw await sarvamHttpError(res)

  const body = (await res.json()) as { audios?: unknown }
  const first = Array.isArray(body.audios) ? body.audios[0] : null
  if (typeof first !== 'string' || !first) {
    throw new AiError('Sarvam returned empty audio.', {
      code: 'empty_audio',
      status: 502,
    })
  }

  const bytes = Uint8Array.from(Buffer.from(first, 'base64'))
  if (bytes.byteLength === 0) {
    throw new AiError('Sarvam returned empty audio.', {
      code: 'empty_audio',
      status: 502,
    })
  }

  return { bytes, mimeType: mimeForCodec(codec) }
}

function mimeForCodec(codec: string): string {
  if (codec === SARVAM_WHATSAPP_CODEC) return SARVAM_TTS_MIME_OPUS
  if (codec === 'wav') return SARVAM_TTS_MIME_WAV
  return SARVAM_TTS_MIME_MP3
}
