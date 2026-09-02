import { describe, it, expect, vi, afterEach } from 'vitest'
import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { LIVE_AI_HANDOFF_SPOKEN } from './live-ai-turn'
import {
  buildLiveAiSpokenInstructions,
  buildRealtimeSessionConfig,
  llmToolsToRealtime,
  proxyRealtimeSdp,
  realtimeSafetyId,
  TRANSFER_TO_HUMAN_TOOL,
  OPENAI_REALTIME_CALLS_URL,
} from './live-ai-realtime'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live AI Realtime session helpers', () => {
  it('hashes a stable safety identifier', () => {
    const a = realtimeSafetyId('acct-1', 'contact-1')
    const b = realtimeSafetyId('acct-1', 'contact-1')
    const c = realtimeSafetyId('acct-1', 'contact-2')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })

  it('maps LLM tools to Realtime function tools', () => {
    expect(
      llmToolsToRealtime([
        {
          name: 'search_products',
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
      ]),
    ).toEqual([
      {
        type: 'function',
        name: 'search_products',
        description: 'Search',
        parameters: { type: 'object', properties: {} },
      },
    ])
  })

  it('asks the model to greet and hand off with the spoken line', () => {
    const text = buildLiveAiSpokenInstructions({
      systemPrompt: 'You sell bags.',
      thread: [{ role: 'user', content: 'Hi' }],
    })
    expect(text).toContain('You sell bags.')
    expect(text).toContain(LIVE_AI_HANDOFF_SPOKEN)
    expect(text).toContain(TRANSFER_TO_HUMAN_TOOL)
    expect(text).toContain(HANDOFF_SENTINEL)
    expect(text).toContain('Customer: Hi')
  })

  it('builds a GA Realtime session with tools and voice', () => {
    const session = buildRealtimeSessionConfig({
      instructions: 'Be brief.',
      tools: [],
      voice: 'marin',
    })
    expect(session.type).toBe('realtime')
    expect(session.instructions).toBe('Be brief.')
    expect(session.output_modalities).toEqual(['audio'])
    expect((session.audio as { output: { voice: string } }).output.voice).toBe('marin')
  })

  it('proxies SDP to OpenAI and returns the answer', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(OPENAI_REALTIME_CALLS_URL)
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-test')
      expect(headers['OpenAI-Safety-Identifier']).toBe('safe')
      const body = init?.body as FormData
      expect(body.get('sdp')).toBe('v=0\r\noffer')
      return new Response('v=0\r\nanswer', { status: 200 })
    }) as unknown as typeof fetch

    const sdp = await proxyRealtimeSdp({
      apiKey: 'sk-test',
      sdp: 'v=0\r\noffer',
      session: { type: 'realtime' },
      safetyId: 'safe',
      fetchImpl,
    })
    expect(sdp).toBe('v=0\r\nanswer')
  })

  it('maps OpenAI auth failures to invalid_key', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 }),
    ) as unknown as typeof fetch

    await expect(
      proxyRealtimeSdp({
        apiKey: 'sk-bad',
        sdp: 'v=0',
        session: {},
        safetyId: 'x',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ status: 401, code: 'invalid_key' })
  })
})
