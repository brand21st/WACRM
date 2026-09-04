import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AI_VOICE_DEFAULTS, type AiConfig } from './types'
import { canSpeak, canTranscribe, synthesizeSpeech, transcribeSpeech } from './speech'

const h = vi.hoisted(() => ({
  elevenLabsStt: vi.fn(),
  elevenLabsTts: vi.fn(),
  sarvamStt: vi.fn(),
  sarvamTts: vi.fn(),
  openaiStt: vi.fn(),
  openaiTts: vi.fn(),
}))

vi.mock('@/lib/elevenlabs/stt', () => ({ speechToText: h.elevenLabsStt }))
vi.mock('@/lib/elevenlabs/tts', () => ({
  textToSpeech: h.elevenLabsTts,
  ELEVENLABS_TTS_MIME: 'audio/mpeg',
  ELEVENLABS_WHATSAPP_VOICE_FORMAT: 'opus_48000_64',
  ELEVENLABS_WHATSAPP_VOICE_MIME: 'audio/ogg',
}))
vi.mock('@/lib/sarvam/stt', () => ({ speechToText: h.sarvamStt }))
vi.mock('@/lib/sarvam/tts', () => ({ textToSpeech: h.sarvamTts }))
vi.mock('@/lib/ai/openai-speech', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/openai-speech')>(
    '@/lib/ai/openai-speech',
  )
  return {
    ...actual,
    openaiSpeechToText: h.openaiStt,
    openaiTextToSpeech: h.openaiTts,
  }
})

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyUnlimited: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...AI_VOICE_DEFAULTS,
    elevenlabsApiKey: 'xi-test',
    sttEnabled: true,
    ttsEnabled: true,
    ...overrides,
  }
}

const AUDIO = new Uint8Array([1, 2, 3])

beforeEach(() => {
  h.elevenLabsStt.mockReset().mockResolvedValue('hello from elevenlabs')
  h.sarvamStt.mockReset().mockResolvedValue('namaste from sarvam')
  h.elevenLabsTts.mockReset().mockResolvedValue({
    bytes: new Uint8Array([9]),
    mimeType: 'audio/mpeg',
  })
  h.sarvamTts.mockReset().mockResolvedValue({
    bytes: new Uint8Array([8]),
    mimeType: 'audio/ogg',
  })
  h.openaiStt.mockReset().mockResolvedValue('hello from openai')
  h.openaiTts.mockReset().mockResolvedValue({
    bytes: new Uint8Array([7]),
    mimeType: 'audio/ogg',
  })
})

describe('speech dispatch', () => {
  it('transcribes with ElevenLabs by default', async () => {
    const text = await transcribeSpeech({
      config: config(),
      audio: AUDIO,
      mimeType: 'audio/ogg',
    })
    expect(text).toBe('hello from elevenlabs')
    expect(h.elevenLabsStt).toHaveBeenCalled()
    expect(h.sarvamStt).not.toHaveBeenCalled()
  })

  it('forwards an ElevenLabs STT hint only when provided', async () => {
    await transcribeSpeech({
      config: config(),
      audio: AUDIO,
      mimeType: 'audio/ogg',
    })
    expect(h.elevenLabsStt).toHaveBeenCalledWith(
      expect.not.objectContaining({ languageCode: expect.anything() }),
    )

    await transcribeSpeech({
      config: config(),
      audio: AUDIO,
      mimeType: 'audio/ogg',
      languageHint: 'ml',
    })
    expect(h.elevenLabsStt).toHaveBeenLastCalledWith(
      expect.objectContaining({ languageCode: 'ml' }),
    )
  })

  it('transcribes with Sarvam when voice_provider is sarvam', async () => {
    const text = await transcribeSpeech({
      config: config({
        voiceProvider: 'sarvam',
        sarvamApiKey: 'sv-test',
      }),
      audio: AUDIO,
      mimeType: 'audio/ogg',
    })
    expect(text).toBe('namaste from sarvam')
    expect(h.sarvamStt).toHaveBeenCalled()
    expect(h.elevenLabsStt).not.toHaveBeenCalled()
    expect(h.sarvamStt).toHaveBeenCalledWith(
      expect.objectContaining({ languageCode: 'unknown' }),
    )
  })

  it('maps a locked ISO hint to a Sarvam BCP-47 code', async () => {
    await transcribeSpeech({
      config: config({
        voiceProvider: 'sarvam',
        sarvamApiKey: 'sv-test',
      }),
      audio: AUDIO,
      mimeType: 'audio/ogg',
      languageHint: 'ml',
    })
    expect(h.sarvamStt).toHaveBeenCalledWith(
      expect.objectContaining({ languageCode: 'ml-IN' }),
    )
  })

  it('synthesises with ElevenLabs by default', async () => {
    const spoken = await synthesizeSpeech({
      config: config(),
      text: 'Hello',
      whatsapp: true,
    })
    expect(Array.from(spoken.bytes)).toEqual([9])
    expect(h.elevenLabsTts).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello' }),
    )
    expect(h.elevenLabsTts.mock.calls[0][0].languageCode).toBeUndefined()
    expect(h.sarvamTts).not.toHaveBeenCalled()
  })

  it('prefers customer languageHint over English-looking reply text', async () => {
    await synthesizeSpeech({
      config: config(),
      text: 'This is available for you.',
      whatsapp: true,
      languageHint: 'ml',
    })
    expect(h.elevenLabsTts).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCode: 'ml',
      }),
    )
  })

  it('locks Malayalam on Latin Manglish via languageHint', async () => {
    await synthesizeSpeech({
      config: config(),
      text: 'Anil sir, ithu ready aanu',
      whatsapp: true,
      languageHint: 'ml',
    })
    expect(h.elevenLabsTts).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCode: 'ml',
      }),
    )
  })

  it('hints Malayalam on ElevenLabs when the reply is Malayalam script', async () => {
    await synthesizeSpeech({
      config: config(),
      text: 'നമസ്കാരം',
      whatsapp: true,
    })
    expect(h.elevenLabsTts).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'നമസ്കാരം',
        languageCode: 'ml',
      }),
    )
  })

  it('stays on ElevenLabs for Malayalam even when a Sarvam key exists', async () => {
    await synthesizeSpeech({
      config: config({
        voiceProvider: 'elevenlabs',
        sarvamApiKey: 'sv-test',
      }),
      text: 'നമസ്കാരം ₹1499',
      whatsapp: true,
    })
    expect(h.elevenLabsTts).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'നമസ്കാരം, 1499 രൂപ',
        languageCode: 'ml',
      }),
    )
    expect(h.sarvamTts).not.toHaveBeenCalled()
  })

  it('synthesises with Sarvam when voice_provider is sarvam', async () => {
    const spoken = await synthesizeSpeech({
      config: config({
        voiceProvider: 'sarvam',
        sarvamApiKey: 'sv-test',
        sarvamSpeaker: 'priya',
        sarvamLanguageCode: 'hi-IN',
      }),
      text: 'Namaste',
      whatsapp: true,
    })
    expect(Array.from(spoken.bytes)).toEqual([8])
    expect(h.sarvamTts).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sv-test',
        speaker: 'priya',
        languageCode: 'hi-IN',
        outputAudioCodec: 'opus',
      }),
    )
    expect(h.elevenLabsTts).not.toHaveBeenCalled()
  })

  it('overrides the Sarvam settings language when the reply is Malayalam', async () => {
    await synthesizeSpeech({
      config: config({
        voiceProvider: 'sarvam',
        sarvamApiKey: 'sv-test',
        sarvamLanguageCode: 'en-IN',
      }),
      text: 'നമസ്കാരം',
      whatsapp: true,
    })
    expect(h.sarvamTts).toHaveBeenCalledWith(
      expect.objectContaining({
        languageCode: 'ml-IN',
        pace: 0.9,
      }),
    )
  })

  it('canTranscribe/canSpeak follow the selected provider key', () => {
    expect(
      canTranscribe(config({ elevenlabsApiKey: null, apiKey: '' })),
    ).toBe(false)
    expect(canTranscribe(config({ elevenlabsApiKey: null }))).toBe(true)
    expect(
      canSpeak(
        config({
          voiceProvider: 'sarvam',
          elevenlabsApiKey: null,
          sarvamApiKey: 'sv',
        }),
      ),
    ).toBe(true)
  })

  it('falls back to OpenAI speech when ElevenLabs is unset', async () => {
    const cfg = config({ elevenlabsApiKey: null })
    const text = await transcribeSpeech({
      config: cfg,
      audio: AUDIO,
      mimeType: 'audio/ogg',
    })
    expect(text).toBe('hello from openai')
    expect(h.elevenLabsStt).not.toHaveBeenCalled()
    expect(h.openaiStt).toHaveBeenCalled()

    const spoken = await synthesizeSpeech({
      config: cfg,
      text: 'Hello',
      whatsapp: true,
    })
    expect(spoken.bytes).toEqual(new Uint8Array([7]))
    expect(h.elevenLabsTts).not.toHaveBeenCalled()
    expect(h.openaiTts).toHaveBeenCalled()
  })
})
