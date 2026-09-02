import { AiError } from '@/lib/ai/types'
import { elevenLabsHttpError, toElevenLabsNetworkError } from './errors'
import { elevenLabsTimeoutMs } from './limits'
import { prepareSpeechText } from './speech-text'

export const ELEVENLABS_TTS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech'
/** Current ElevenLabs flagship TTS model. */
export const ELEVENLABS_TTS_MODEL = 'eleven_v3'
/** Always spell out numbers/dates — `auto` often skips WhatsApp replies. */
export const ELEVENLABS_TEXT_NORMALIZATION = 'on' as const
export const ELEVENLABS_TTS_MIME = 'audio/mpeg'
/** Opus in Ogg — WhatsApp renders this as a native voice note (waveform). */
export const ELEVENLABS_WHATSAPP_VOICE_FORMAT = 'opus_48000_64'
export const ELEVENLABS_WHATSAPP_VOICE_MIME = 'audio/ogg'
/** Cap on spoken reply length — WhatsApp-sized, bounds TTS spend. */
export const TTS_MAX_CHARS = 5000

export interface TextToSpeechArgs {
  apiKey: string
  voiceId: string
  text: string
  modelId?: string
  /** ISO 639-1 hint for Indic replies (`ml`, `hi`, …). Omitted on Latin. */
  languageCode?: string
  /** ElevenLabs `output_format` query param, e.g. `opus_48000_64`. */
  outputFormat?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface TextToSpeechResult {
  bytes: Uint8Array
  mimeType: string
}

/**
 * Text-to-speech via ElevenLabs convert API.
 *
 * POST `/v1/text-to-speech/{voice_id}` with JSON
 * `{ text, model_id, apply_text_normalization, language_code? }`.
 * Text is shaped for speech first (currency, long ids, v3 audio tags);
 * the inbox caption stays original. Indic `language_code` is kept;
 * it is dropped only if v3 rejects that field itself.
 * Returns audio bytes. Pass `outputFormat: opus_48000_64` for WhatsApp
 * voice notes. Throws `AiError` on empty text, auth failure, rate
 * limit, timeout, or any other provider error.
 */
export async function textToSpeech(
  args: TextToSpeechArgs,
): Promise<TextToSpeechResult> {
  const text = prepareSpeechText(args.text)
  if (!text) {
    throw new AiError('Nothing to speak.', {
      code: 'empty_text',
      status: 400,
    })
  }
  if (text.length > TTS_MAX_CHARS) {
    throw new AiError(
      `Text is too long for speech (${text.length} characters). Maximum is ${TTS_MAX_CHARS}.`,
      { code: 'text_too_long', status: 400 },
    )
  }

  const voiceId = args.voiceId.trim()
  if (!voiceId) {
    throw new AiError('A voice id is required.', {
      code: 'missing_voice',
      status: 400,
    })
  }

  const timeoutMs = args.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = args.fetchImpl ?? fetch
  const outputFormat = args.outputFormat?.trim()
  const url = outputFormat
    ? `${ELEVENLABS_TTS_BASE}/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`
    : `${ELEVENLABS_TTS_BASE}/${encodeURIComponent(voiceId)}`
  const languageCode = args.languageCode?.trim() || ''
  const baseBody = {
    text,
    model_id: args.modelId ?? ELEVENLABS_TTS_MODEL,
    apply_text_normalization: ELEVENLABS_TEXT_NORMALIZATION,
  }

  let res: Response
  try {
    res = await postConvert(fetchImpl, url, args.apiKey, {
      ...baseBody,
      ...(languageCode ? { language_code: languageCode } : {}),
    }, timeoutMs)
    // Last resort only: v3 sometimes rejects the language_code field
    // itself. Do not drop the language on unrelated 400s.
    if (
      !res.ok &&
      res.status === 400 &&
      languageCode &&
      (await rejectsLanguageCodeField(res))
    ) {
      res = await postConvert(fetchImpl, url, args.apiKey, baseBody, timeoutMs)
    }
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }

  if (!res.ok) throw await elevenLabsHttpError(res)

  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength === 0) {
    throw new AiError('ElevenLabs returned empty audio.', {
      code: 'empty_audio',
      status: 502,
    })
  }
  const responseMime =
    res.headers.get('content-type')?.split(';')[0].trim() || null
  const mime = mimeForOutputFormat(outputFormat, responseMime)
  return { bytes: buf, mimeType: mime }
}

function languageCodeFieldRejected(detail: unknown): boolean {
  const msg =
    typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message?: unknown }).message ?? '')
        : Array.isArray(detail)
          ? detail
              .map((d) =>
                d && typeof d === 'object' && ('message' in d || 'msg' in d)
                  ? String(
                      (d as { message?: unknown; msg?: unknown }).message ??
                        (d as { msg?: unknown }).msg ??
                        '',
                    )
                  : '',
              )
              .join(' ')
          : ''
  return (
    /language_code/i.test(msg) &&
    /unknown field|not supported|does not support|unexpected|extra fields?/i.test(msg)
  )
}

async function rejectsLanguageCodeField(res: Response): Promise<boolean> {
  try {
    const cloned =
      typeof res.clone === 'function' ? res.clone() : res
    const body = (await cloned.json()) as { detail?: unknown }
    return languageCodeFieldRejected(body?.detail)
  } catch {
    return false
  }
}

async function postConvert(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  return fetchImpl(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: ELEVENLABS_TTS_MIME,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function mimeForOutputFormat(
  outputFormat: string | undefined,
  responseMime: string | null,
): string {
  if (outputFormat?.startsWith('opus_')) return ELEVENLABS_WHATSAPP_VOICE_MIME
  if (outputFormat?.startsWith('mp3_')) return ELEVENLABS_TTS_MIME
  return responseMime || ELEVENLABS_TTS_MIME
}
