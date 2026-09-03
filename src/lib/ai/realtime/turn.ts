import { AiError, type AiUsage, type ChatMessage } from '@/lib/ai/types'
import { parseGeneration } from '@/lib/ai/generate'
import { realtimeError, realtimeServerError } from './errors'
import { effectiveRealtimeVoice } from './voices'

/** Cheaper Realtime model for WhatsApp one-shot turns. Override with AI_REALTIME_MODEL. */
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1-mini'

/** Reasoning voice model for inbound Live AI WhatsApp calls. Override with AI_LIVE_CALL_REALTIME_MODEL. */
export const DEFAULT_LIVE_CALL_REALTIME_MODEL = 'gpt-realtime-2.1'

/** PCM16 mono sample rate Realtime emits for audio/pcm. */
export const REALTIME_PCM_SAMPLE_RATE = 24_000

/** Must finish inside the webhook after() budget (60s). */
export const REALTIME_TURN_TIMEOUT_MS = 45_000

export function realtimeModelId(): string {
  const raw = process.env.AI_REALTIME_MODEL?.trim()
  return raw || DEFAULT_REALTIME_MODEL
}

export function liveCallRealtimeModelId(): string {
  const raw = process.env.AI_LIVE_CALL_REALTIME_MODEL?.trim()
  return raw || DEFAULT_LIVE_CALL_REALTIME_MODEL
}

export interface RealtimeTurnArgs {
  apiKey: string
  systemPrompt: string
  messages: ChatMessage[]
  voice?: string | null
  timeoutMs?: number
  /** Injected in tests. */
  connect?: RealtimeConnect
}

export interface RealtimeTurnResult {
  text: string
  handoff: boolean
  pcm: Uint8Array
  sampleRate: number
  usage: AiUsage | null
  model: string
}

export interface RealtimeConnect {
  (url: string, headers: Record<string, string>): RealtimeSocket
}

export interface RealtimeSocket {
  send(data: string): void
  close(): void
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: { data?: unknown }) => void,
  ): void
  removeEventListener?(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: { data?: unknown }) => void,
  ): void
}

/**
 * One WhatsApp turn over OpenAI Realtime: replay recent text context,
 * ask for a spoken reply, collect PCM16 + transcript, then close.
 */
export async function realtimeTurn(
  args: RealtimeTurnArgs,
): Promise<RealtimeTurnResult> {
  const model = realtimeModelId()
  const voice = effectiveRealtimeVoice(args.voice)
  const timeoutMs = args.timeoutMs ?? REALTIME_TURN_TIMEOUT_MS
  const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`
  const connect = args.connect ?? defaultConnect

  let socket: RealtimeSocket
  try {
    socket = connect(url, { Authorization: `Bearer ${args.apiKey}` })
  } catch (err) {
    throw realtimeError(err, 'Could not open OpenAI Realtime.')
  }

  const pcmChunks: Buffer[] = []
  let transcript = ''
  let usage: AiUsage | null = null
  let settled = false

  return new Promise<RealtimeTurnResult>((resolve, reject) => {
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // ignore
      }
      reject(err instanceof AiError ? err : realtimeError(err))
    }

    const succeed = (result: RealtimeTurnResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // ignore
      }
      resolve(result)
    }

    const timer = setTimeout(() => {
      fail(
        new AiError('OpenAI Realtime took too long to respond.', {
          code: 'timeout',
          status: 504,
        }),
      )
    }, timeoutMs)

    const send = (event: Record<string, unknown>) => {
      socket.send(JSON.stringify(event))
    }

    const replayContext = () => {
      send({
        type: 'session.update',
        session: {
          type: 'realtime',
          model,
          output_modalities: ['audio'],
          instructions: args.systemPrompt,
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: REALTIME_PCM_SAMPLE_RATE },
              turn_detection: null,
            },
            output: {
              format: { type: 'audio/pcm', rate: REALTIME_PCM_SAMPLE_RATE },
              voice,
            },
          },
        },
      })
      for (const msg of args.messages) {
        const text = msg.content.trim()
        if (!text) continue
        send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: msg.role,
            content: [
              msg.role === 'user'
                ? { type: 'input_text', text }
                : { type: 'output_text', text },
            ],
          },
        })
      }
      send({
        type: 'response.create',
        response: { output_modalities: ['audio'] },
      })
    }

    socket.addEventListener('error', (event) => {
      fail(realtimeError(event, 'OpenAI Realtime socket error.'))
    })
    socket.addEventListener('close', () => {
      if (!settled) {
        fail(
          new AiError('OpenAI Realtime closed before a reply finished.', {
            code: 'network_error',
            status: 502,
          }),
        )
      }
    })
    socket.addEventListener('open', () => {
      // Wait for session.created before configuring — some servers
      // drop session.update that races the handshake.
    })
    socket.addEventListener('message', (event) => {
      let payload: Record<string, unknown>
      try {
        const raw =
          typeof event.data === 'string'
            ? event.data
            : Buffer.isBuffer(event.data)
              ? event.data.toString('utf8')
              : String(event.data ?? '')
        payload = JSON.parse(raw) as Record<string, unknown>
      } catch {
        return
      }
      const type = typeof payload.type === 'string' ? payload.type : ''
      if (type === 'error') {
        fail(realtimeServerError(payload as { error?: { message?: string; code?: string } }))
        return
      }
      if (type === 'session.created') {
        replayContext()
        return
      }
      if (type === 'response.output_audio.delta' || type === 'response.audio.delta') {
        const delta = typeof payload.delta === 'string' ? payload.delta : ''
        if (delta) pcmChunks.push(Buffer.from(delta, 'base64'))
        return
      }
      if (
        type === 'response.output_audio_transcript.done' ||
        type === 'response.audio_transcript.done'
      ) {
        if (typeof payload.transcript === 'string') transcript = payload.transcript
        return
      }
      if (type === 'response.done') {
        const response = (payload.response ?? {}) as Record<string, unknown>
        usage = usageFromResponse(response)
        if (!transcript) transcript = textFromResponse(response)
        const parsed = parseGeneration(transcript, usage)
        const pcm = Buffer.concat(pcmChunks)
        if (!parsed.handoff && pcm.byteLength === 0 && !parsed.text) {
          fail(
            new AiError('OpenAI Realtime returned an empty reply.', {
              code: 'empty_audio',
              status: 502,
            }),
          )
          return
        }
        succeed({
          text: parsed.text,
          handoff: parsed.handoff,
          pcm: new Uint8Array(pcm),
          sampleRate: REALTIME_PCM_SAMPLE_RATE,
          usage: parsed.usage,
          model,
        })
      }
    })
  })
}

function usageFromResponse(response: Record<string, unknown>): AiUsage | null {
  const usage = response.usage as
    | {
        input_tokens?: number
        output_tokens?: number
        total_tokens?: number
        prompt_tokens?: number
        completion_tokens?: number
      }
    | undefined
  if (!usage) return null
  const promptTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0)
  const completionTokens = Number(
    usage.output_tokens ?? usage.completion_tokens ?? 0,
  )
  const totalTokens = Number(
    usage.total_tokens ?? promptTokens + completionTokens,
  )
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) return null
  return { promptTokens, completionTokens, totalTokens }
}

function textFromResponse(response: Record<string, unknown>): string {
  const output = Array.isArray(response.output) ? response.output : []
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const rec = part as { transcript?: unknown; text?: unknown }
      if (typeof rec.transcript === 'string') parts.push(rec.transcript)
      else if (typeof rec.text === 'string') parts.push(rec.text)
    }
  }
  return parts.join('').trim()
}

function defaultConnect(
  url: string,
  headers: Record<string, string>,
): RealtimeSocket {
  // Lazy-require so tests can inject a fake without pulling `ws`.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebSocket } = require('ws') as typeof import('ws')
  const socket = new WebSocket(url, { headers })
  return {
    send(data) {
      socket.send(data)
    },
    close() {
      socket.close()
    },
    addEventListener(type, listener) {
      socket.on(type, (data: unknown) => {
        if (type === 'message') listener({ data })
        else listener({})
      })
    },
  }
}

export {
  DEFAULT_REALTIME_VOICE,
  effectiveRealtimeVoice,
  parseRealtimeVoice,
} from './voices'
export type { RealtimeVoice } from './voices'
