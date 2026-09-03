import { describe, it, expect, vi, afterEach } from 'vitest'
import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { DETECT_FIRST_SPOKEN_LANGUAGE } from '@/lib/ai/language-lock'
import { LIVE_AI_GREETING_NEUTRAL, LIVE_AI_GREETING_USER, LIVE_AI_HANDOFF_SPOKEN } from './live-ai-turn'
import { liveAiCallUserPrompt } from './live-ai-prompt'
import {
  buildLiveAiSpokenInstructions,
  buildRealtimeCallMultipart,
  buildRealtimeSessionConfig,
  llmToolsToRealtime,
  proxyRealtimeSdp,
  realtimeSafetyId,
  TRANSFER_TO_HUMAN_TOOL,
  OPENAI_REALTIME_CALLS_URL,
} from './live-ai-realtime'
import { LIVE_AI_TTS_MODEL } from './live-ai-constants'

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
    expect(text).toContain('search_customer_memory')
    expect(text).toContain('Answer simple questions immediately')
    expect(text).toContain('one-sentence preamble')
    expect(text).toContain(LIVE_AI_GREETING_NEUTRAL)
    expect(text).toContain(DETECT_FIRST_SPOKEN_LANGUAGE)
    expect(text).not.toContain(LIVE_AI_GREETING_USER)
    expect(text).not.toContain('This call will be recorded')
  })

  it('carries call behaviour into spoken instructions', () => {
    const userPrompt = liveAiCallUserPrompt({
      behaviour: 'Warm and brief',
      businessContext: null,
      instructions: null,
      chatPrompt: 'Chat-only',
    })
    const text = buildLiveAiSpokenInstructions({
      systemPrompt: userPrompt ?? '',
    })
    expect(text).toContain('Call behaviour:')
    expect(text).toContain('Warm and brief')
    expect(text).not.toContain('Chat-only')
  })

  it('omits recording announcements from spoken memory', () => {
    const text = buildLiveAiSpokenInstructions({
      systemPrompt: 'You sell bags.',
      thread: [
        {
          role: 'user',
          content: 'This call will be recorded for the following purpose: quality',
        },
        { role: 'user', content: 'Need a bag' },
      ],
    })
    expect(text).toContain('Customer: Need a bag')
    expect(text).not.toContain('will be recorded')
  })

  it('builds a GA Realtime session with tools and voice', () => {
    const session = buildRealtimeSessionConfig({
      instructions: 'Be brief.',
      tools: [],
      voice: 'marin',
    })
    expect(session.type).toBe('realtime')
    expect(session.model).toBe('gpt-realtime-2.1')
    expect(session.reasoning).toEqual({ effort: 'low' })
    expect(session.instructions).toBe('Be brief.')
    expect(session.output_modalities).toEqual(['audio'])
    expect((session.audio as { output: { voice: string } }).output.voice).toBe('marin')
    expect(
      (session.audio as { input: { turn_detection: { create_response: boolean } } }).input
        .turn_detection.create_response,
    ).toBe(true)
    expect(
      (session.audio as { input: { transcription: { model?: string; languages?: string[] } } })
        .input.transcription.model,
    ).toBe('gpt-live-transcribe')
    expect(
      (session.audio as { input: { transcription: { languages?: string[] } } }).input
        .transcription.languages,
    ).toBeUndefined()
  })

  it('hints Malayalam plus English on gpt-live-transcribe when locked', () => {
    const locked = buildRealtimeSessionConfig({
      instructions: 'Be brief.',
      tools: [],
      transcriptionLanguage: 'ml',
    })
    expect(
      (locked.audio as { input: { transcription: { model?: string; languages?: string[]; delay?: string } } })
        .input.transcription,
    ).toMatchObject({
      model: 'gpt-live-transcribe',
      languages: ['ml', 'en'],
      delay: 'medium',
    })

    const unlocked = buildRealtimeSessionConfig({
      instructions: 'Be brief.',
      tools: [],
      transcriptionLanguage: null,
    })
    expect(
      (unlocked.audio as { input: { transcription: { languages?: string[] } } }).input
        .transcription.languages,
    ).toBeUndefined()
  })

  it('uses the locked-language greeting when a hard lock exists', () => {
    const text = buildLiveAiSpokenInstructions({
      systemPrompt: 'You sell bags.',
      replyLanguage: {
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      },
    })
    expect(text).toContain(LIVE_AI_GREETING_USER)
    expect(text).toContain('This WhatsApp voice call is in Malayalam')
    expect(text).toContain('Kerala Malayalam')
    expect(text).toContain('ഇതുണ്ട്, നോക്കിക്കോ')
    expect(text).not.toContain(DETECT_FIRST_SPOKEN_LANGUAGE)
  })

  it('greets in Kerala Malayalam when prior chat was Malayalam', () => {
    const text = buildLiveAiSpokenInstructions({
      systemPrompt: 'You sell bags.',
      languageHint: 'Malayalam',
    })
    expect(text).toContain('Prior WhatsApp')
    expect(text).toContain('ഹലോ, എന്താ സഹായിക്കട്ടെ')
    expect(text).toContain('Kerala Malayalam')
  })

  it('asks Realtime for text when live TTS voice is on', () => {
    const session = buildRealtimeSessionConfig({
      instructions: 'Be brief.',
      tools: [],
      ttsVoice: true,
    })
    expect(session.output_modalities).toEqual(['text'])
    expect(
      (session.audio as { input: { turn_detection: { interrupt_response: boolean } } }).input
        .turn_detection.interrupt_response,
    ).toBe(false)
    expect((session.audio as { output?: unknown }).output).toBeUndefined()
  })

  it('speaks live replies with ElevenLabs v3', () => {
    expect(LIVE_AI_TTS_MODEL).toBe('eleven_v3')
  })

  it('encodes sdp and session as named multipart parts', () => {
    const { body, contentType } = buildRealtimeCallMultipart('v=0\r\noffer', {
      type: 'realtime',
    })
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----WebKitFormBoundary/)
    expect(body).toContain('name="sdp"')
    expect(body).toContain('Content-Type: application/sdp')
    expect(body).toContain('v=0\r\noffer')
    expect(body).toMatch(/v=0\r\noffer\r\n\r\n------WebKitFormBoundary/)
    expect(body).toContain('name="session"')
    expect(body).toContain('Content-Type: application/json')
    expect(body).toContain('{"type":"realtime"}')
  })

  it('proxies SDP to OpenAI and returns the answer', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(OPENAI_REALTIME_CALLS_URL)
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk-test')
      expect(headers['OpenAI-Safety-Identifier']).toBe('safe')
      expect(headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/)
      expect(String(init?.body)).toContain('name="sdp"')
      expect(String(init?.body)).toContain('v=0\r\noffer')
      return new Response('v=0\r\nanswer', { status: 201 })
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
