import { describe, it, expect } from 'vitest'
import {
  realtimeTurn,
  REALTIME_PCM_SAMPLE_RATE,
  DEFAULT_REALTIME_MODEL,
  DEFAULT_LIVE_CALL_REALTIME_MODEL,
  liveCallRealtimeModelId,
} from './turn'
import type { RealtimeSocket } from './turn'
import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { AiError } from '@/lib/ai/types'

class FakeSocket implements RealtimeSocket {
  readonly sent: Record<string, unknown>[] = []
  private readonly listeners = new Map<
    string,
    Array<(event: { data?: unknown }) => void>
  >()
  private readonly afterCreate: Record<string, unknown>[]
  closed = false

  constructor(afterCreate: Record<string, unknown>[]) {
    this.afterCreate = afterCreate
  }

  send(data: string) {
    const event = JSON.parse(data) as Record<string, unknown>
    this.sent.push(event)
    if (event.type === 'response.create') {
      queueMicrotask(() => {
        for (const payload of this.afterCreate) this.emit(payload)
      })
    }
  }

  close() {
    this.closed = true
  }

  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: { data?: unknown }) => void,
  ) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
    if (type === 'message' && list.length === 1) {
      queueMicrotask(() => this.emit({ type: 'session.created' }))
    }
  }

  emit(payload: Record<string, unknown>) {
    const raw = JSON.stringify(payload)
    for (const fn of this.listeners.get('message') ?? []) fn({ data: raw })
  }
}

const PCM_B64 = Buffer.from([0, 1, 2, 3]).toString('base64')

const HAPPY_EVENTS: Record<string, unknown>[] = [
  { type: 'response.output_audio.delta', delta: PCM_B64 },
  { type: 'response.output_audio_transcript.done', transcript: 'Hello there' },
  {
    type: 'response.done',
    response: {
      usage: { input_tokens: 11, output_tokens: 5, total_tokens: 16 },
    },
  },
]

describe('realtimeTurn', () => {
  it('defaults to a current Realtime model id', () => {
    expect(DEFAULT_REALTIME_MODEL).toBe('gpt-realtime-2.1-mini')
    expect(DEFAULT_LIVE_CALL_REALTIME_MODEL).toBe('gpt-realtime-2.1')
    expect(liveCallRealtimeModelId()).toBe('gpt-realtime-2.1')
  })

  it('replays context, collects PCM + transcript, and closes', async () => {
    const socket = new FakeSocket(HAPPY_EVENTS)
    const result = await realtimeTurn({
      apiKey: 'sk-test',
      systemPrompt: 'Be brief.',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'status?' },
      ],
      voice: 'alloy',
      connect: () => socket,
    })

    expect(result.text).toBe('Hello there')
    expect(result.handoff).toBe(false)
    expect(Array.from(result.pcm)).toEqual([0, 1, 2, 3])
    expect(result.sampleRate).toBe(REALTIME_PCM_SAMPLE_RATE)
    expect(result.usage).toEqual({
      promptTokens: 11,
      completionTokens: 5,
      totalTokens: 16,
    })
    expect(socket.closed).toBe(true)

    expect(socket.sent[0]).toMatchObject({
      type: 'session.update',
      session: {
        output_modalities: ['audio'],
        audio: { output: { voice: 'alloy' } },
      },
    })
    expect(socket.sent.filter((e) => e.type === 'conversation.item.create')).toHaveLength(3)
    expect(socket.sent.at(-1)).toMatchObject({
      type: 'response.create',
      response: { output_modalities: ['audio'] },
    })
  })

  it('detects the handoff sentinel in the transcript', async () => {
    const socket = new FakeSocket([
      {
        type: 'response.output_audio_transcript.done',
        transcript: HANDOFF_SENTINEL,
      },
      { type: 'response.done', response: {} },
    ])
    const result = await realtimeTurn({
      apiKey: 'sk-test',
      systemPrompt: 'handoff rules',
      messages: [{ role: 'user', content: 'human please' }],
      connect: () => socket,
    })
    expect(result.handoff).toBe(true)
    expect(result.text).toBe('')
  })

  it('maps a server error event to AiError', async () => {
    const socket = new FakeSocket([
      { type: 'error', error: { message: 'invalid_api_key', code: 'invalid_api_key' } },
    ])
    await expect(
      realtimeTurn({
        apiKey: 'bad',
        systemPrompt: 'x',
        messages: [{ role: 'user', content: 'hi' }],
        connect: () => socket,
      }),
    ).rejects.toMatchObject({ code: 'invalid_key' } satisfies Partial<AiError>)
  })
})
