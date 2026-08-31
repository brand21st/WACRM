import { elevenLabsHttpError, toElevenLabsNetworkError } from './errors'
import { elevenLabsTimeoutMs } from './limits'
import { AiError } from '@/lib/ai/types'

const VOICES_URL = 'https://api.elevenlabs.io/v1/voices'
const ADD_VOICE_URL = 'https://api.elevenlabs.io/v1/voices/add'

export const CLONE_MAX_FILES = 10
export const CLONE_MAX_BYTES = 16 * 1024 * 1024
export const CLONE_TIMEOUT_MS = 90_000

export interface ElevenLabsVoice {
  voiceId: string
  name: string
  category: string
  previewUrl: string | null
}

export interface VoiceSettings {
  stability: number
  similarityBoost: number
  style?: number
  useSpeakerBoost?: boolean
}

function authHeaders(apiKey: string): Record<string, string> {
  return { 'xi-api-key': apiKey }
}

export async function listVoices(
  apiKey: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<ElevenLabsVoice[]> {
  const timeoutMs = opts.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(`${VOICES_URL}?show_legacy=false`, {
      method: 'GET',
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
  const body = (await res.json()) as {
    voices?: Array<{
      voice_id?: string
      name?: string
      category?: string
      preview_url?: string | null
    }>
  }
  const voices = Array.isArray(body.voices) ? body.voices : []
  return voices
    .filter((v) => typeof v.voice_id === 'string' && v.voice_id)
    .map((v) => ({
      voiceId: v.voice_id as string,
      name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : v.voice_id!,
      category: typeof v.category === 'string' ? v.category : 'premade',
      previewUrl: typeof v.preview_url === 'string' ? v.preview_url : null,
    }))
}

export interface AddVoiceArgs {
  apiKey: string
  name: string
  description?: string
  files: Array<{ bytes: Uint8Array; mimeType: string; fileName: string }>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function addVoice(args: AddVoiceArgs): Promise<{ voiceId: string }> {
  const name = args.name.trim()
  if (!name) {
    throw new AiError('A voice name is required.', {
      code: 'missing_name',
      status: 400,
    })
  }
  if (args.files.length === 0) {
    throw new AiError('At least one audio sample is required.', {
      code: 'missing_audio',
      status: 400,
    })
  }
  if (args.files.length > CLONE_MAX_FILES) {
    throw new AiError(`At most ${CLONE_MAX_FILES} samples can be uploaded.`, {
      code: 'too_many_files',
      status: 400,
    })
  }
  for (const file of args.files) {
    if (file.bytes.byteLength === 0) {
      throw new AiError('An audio sample is empty.', {
        code: 'empty_audio',
        status: 400,
      })
    }
    if (file.bytes.byteLength > CLONE_MAX_BYTES) {
      throw new AiError(
        `An audio sample is too large (${file.bytes.byteLength} bytes).`,
        { code: 'audio_too_large', status: 400 },
      )
    }
  }

  const form = new FormData()
  form.append('name', name)
  if (args.description?.trim()) form.append('description', args.description.trim())
  for (const file of args.files) {
    form.append(
      'files',
      new Blob([Buffer.from(file.bytes)], { type: file.mimeType }),
      file.fileName,
    )
  }

  const timeoutMs = args.timeoutMs ?? CLONE_TIMEOUT_MS
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(ADD_VOICE_URL, {
      method: 'POST',
      headers: authHeaders(args.apiKey),
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
  const body = (await res.json()) as { voice_id?: unknown }
  const voiceId = typeof body.voice_id === 'string' ? body.voice_id.trim() : ''
  if (!voiceId) {
    throw new AiError('ElevenLabs did not return a voice id.', {
      code: 'provider_error',
      status: 502,
    })
  }
  return { voiceId }
}

export interface EditVoiceArgs {
  apiKey: string
  voiceId: string
  name?: string
  files?: Array<{ bytes: Uint8Array; mimeType: string; fileName: string }>
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function editVoice(args: EditVoiceArgs): Promise<void> {
  const voiceId = args.voiceId.trim()
  if (!voiceId) {
    throw new AiError('A voice id is required.', {
      code: 'missing_voice',
      status: 400,
    })
  }
  const form = new FormData()
  if (args.name?.trim()) form.append('name', args.name.trim())
  for (const file of args.files ?? []) {
    if (file.bytes.byteLength > CLONE_MAX_BYTES) {
      throw new AiError('An audio sample is too large.', {
        code: 'audio_too_large',
        status: 400,
      })
    }
    form.append(
      'files',
      new Blob([Buffer.from(file.bytes)], { type: file.mimeType }),
      file.fileName,
    )
  }
  const timeoutMs = args.timeoutMs ?? CLONE_TIMEOUT_MS
  const fetchImpl = args.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(`${VOICES_URL}/${encodeURIComponent(voiceId)}/edit`, {
      method: 'POST',
      headers: authHeaders(args.apiKey),
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
}

export async function getVoiceSettings(
  apiKey: string,
  voiceId: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<VoiceSettings> {
  const timeoutMs = opts.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(
      `${VOICES_URL}/${encodeURIComponent(voiceId)}/settings`,
      {
        method: 'GET',
        headers: authHeaders(apiKey),
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
  const body = (await res.json()) as {
    stability?: number
    similarity_boost?: number
    style?: number
    use_speaker_boost?: boolean
  }
  return {
    stability: Number.isFinite(body.stability) ? Number(body.stability) : 0.5,
    similarityBoost: Number.isFinite(body.similarity_boost)
      ? Number(body.similarity_boost)
      : 0.75,
    style: Number.isFinite(body.style) ? Number(body.style) : undefined,
    useSpeakerBoost: body.use_speaker_boost === true,
  }
}

export async function updateVoiceSettings(
  apiKey: string,
  voiceId: string,
  settings: VoiceSettings,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(
      `${VOICES_URL}/${encodeURIComponent(voiceId)}/settings/edit`,
      {
        method: 'POST',
        headers: {
          ...authHeaders(apiKey),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stability: settings.stability,
          similarity_boost: settings.similarityBoost,
          ...(settings.style != null ? { style: settings.style } : {}),
          ...(settings.useSpeakerBoost != null
            ? { use_speaker_boost: settings.useSpeakerBoost }
            : {}),
        }),
        signal: AbortSignal.timeout(timeoutMs),
      },
    )
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
}

export async function deleteVoice(
  apiKey: string,
  voiceId: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(`${VOICES_URL}/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
      headers: authHeaders(apiKey),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
}
