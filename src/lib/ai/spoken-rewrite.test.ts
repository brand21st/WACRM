import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AI_VOICE_DEFAULTS, type AiConfig } from './types'
import { shouldRewriteSpoken, spokenRewrite } from './spoken-rewrite'

const h = vi.hoisted(() => ({
  generateOpenAi: vi.fn(),
  generateAnthropic: vi.fn(),
}))

vi.mock('./providers/openai', () => ({ generateOpenAi: h.generateOpenAi }))
vi.mock('./providers/anthropic', () => ({ generateAnthropic: h.generateAnthropic }))

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyUnlimited: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...AI_VOICE_DEFAULTS,
    ...overrides,
  }
}

beforeEach(() => {
  h.generateOpenAi.mockReset()
  h.generateAnthropic.mockReset()
})

describe('shouldRewriteSpoken', () => {
  it('skips English, empty drafts, and handoffs', () => {
    expect(
      shouldRewriteSpoken({
        draft: 'Hello there',
        customerText: 'how many left?',
      }),
    ).toBeNull()
    expect(
      shouldRewriteSpoken({
        draft: '',
        customerText: 'ethra und alle',
      }),
    ).toBeNull()
    expect(
      shouldRewriteSpoken({
        draft: 'ok',
        handoff: true,
        customerText: 'ethra und alle',
      }),
    ).toBeNull()
  })

  it('targets Malayalam and Hindi customer turns', () => {
    expect(
      shouldRewriteSpoken({
        draft: 'It is available.',
        customerText: 'ethra und alle',
      }),
    ).toEqual({ sarvam: 'ml-IN', elevenlabs: 'ml' })
    expect(
      shouldRewriteSpoken({
        draft: 'available',
        customerText: 'kitna hai chahiye',
      }),
    ).toEqual({ sarvam: 'hi-IN', elevenlabs: 'hi' })
  })
})

describe('spokenRewrite', () => {
  it('calls the provider for Malayalam and returns the rewrite', async () => {
    h.generateOpenAi.mockResolvedValue({ text: 'spoken ml', usage: null })
    const out = await spokenRewrite({
      config: config(),
      draft: 'stiff formal draft',
      customerText: 'ethra und alle',
    })
    expect(out).toBe('spoken ml')
    expect(h.generateOpenAi).toHaveBeenCalledWith(
      expect.objectContaining({
        maxTokens: 256,
        systemPrompt: expect.stringMatching(/Malayalam/),
      }),
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /honorific|താങ്കൾ/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /Do not add ji, sir, madam/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(/Manglish/)
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /do not translate from English/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /native speaker/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /Fix English word order and calques/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(/ലഭ്യമാണ്/)
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(/നോക്കിക്കോ/)
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).not.toMatch(
      /native script, shop-counter tone/,
    )
  })

  it('rewrites native-script Malayalam without forcing Manglish', async () => {
    h.generateOpenAi.mockResolvedValue({ text: 'ഇതുണ്ട്', usage: null })
    await spokenRewrite({
      config: config(),
      draft: 'താങ്കൾക്ക് ലഭ്യമാണ്',
      customerText: 'എത്രയുണ്ട്',
    })
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /native script/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /do not translate from English/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /Fix English word order and calques/,
    )
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(/ലഭ്യമാണ്/)
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).not.toMatch(/Manglish/)
  })

  it('asks the rewrite to keep a known customer name and honorific', async () => {
    h.generateOpenAi.mockResolvedValue({ text: 'Anil സർ, ഇതുണ്ട്', usage: null })
    await spokenRewrite({
      config: config(),
      draft: 'Anil sir, it is available',
      customerText: 'ethra und alle',
      customerName: 'Anil',
    })
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(/Anil/)
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(/honorific/)
    expect(h.generateOpenAi.mock.calls[0][0].systemPrompt).toMatch(
      /Do not add ji, sir, madam/,
    )
  })

  it('returns the original draft when the provider fails', async () => {
    h.generateOpenAi.mockRejectedValue(new Error('timeout'))
    const draft = 'stiff formal draft'
    const out = await spokenRewrite({
      config: config(),
      draft,
      customerText: 'ethra und alle',
    })
    expect(out).toBe(draft)
  })
})
