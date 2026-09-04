import { AiError } from '@/lib/ai/types'
import { providerHttpError, toNetworkError } from '@/lib/ai/providers/shared'
import { pcm16ToOggOpus } from '@/lib/audio/pcm-to-opus'
import { effectiveRealtimeVoice } from '@/lib/ai/realtime/voices'
import type { AiConfig } from '@/lib/ai/types'

const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions'
const SPEECH_URL = 'https://api.openai.com/v1/audio/speech'
const STT_MODEL = 'whisper-1'
const TTS_MODEL = 'tts-1'
const TTS_TIMEOUT_MS = 30_000
const STT_TIMEOUT_MS = 30_000

export function canUseOpenAiSpeech(
  config: Pick<AiConfig, 'provider' | 'apiKey'>,
): boolean {
  return config.provider === 'openai' && Boolean(config.apiKey?.trim())
}

export async function openaiSpeechToText(args: {
  apiKey: string
  audio: Uint8Array | ArrayBuffer | Buffer
  mimeType: string
  fileName?: string
  languageHint?: string | null
  fetchImpl?: typeof fetch
}): Promise<string> {
  const bytes =
    args.audio instanceof Uint8Array ? args.audio : new Uint8Array(args.audio)
  if (bytes.byteLength === 0) {
    throw new AiError('Audio is empty.', { code: 'empty_audio', status: 400 })
  }

  const mime = args.mimeType.trim() || 'audio/ogg'
  const fileName = args.fileName?.trim() || 'audio.ogg'
  const form = new FormData()
  form.append('model', STT_MODEL)
  form.append(
    'file',
    new Blob([Buffer.from(bytes)], { type: mime }),
    fileName,
  )
  const hint = args.languageHint?.trim()
  if (hint) form.append('language', hint)

  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(STT_TIMEOUT_MS),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('OpenAI', res)
  const body = (await res.json()) as { text?: string }
  return typeof body.text === 'string' ? body.text.trim() : ''
}

export async function openaiTextToSpeech(args: {
  apiKey: string
  text: string
  voice?: string | null
  whatsapp?: boolean
  fetchImpl?: typeof fetch
}): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const text = args.text.trim()
  if (!text) {
    throw new AiError('Nothing to speak.', { code: 'empty_text', status: 400 })
  }

  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(SPEECH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: effectiveRealtimeVoice(args.voice),
        input: text.slice(0, 4096),
        response_format: args.whatsapp ? 'pcm' : 'mp3',
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('OpenAI', res)
  const pcm = new Uint8Array(await res.arrayBuffer())
  if (args.whatsapp) {
    return pcm16ToOggOpus({ pcm, sampleRate: 24_000 })
  }
  return { bytes: pcm, mimeType: 'audio/mpeg' }
}
