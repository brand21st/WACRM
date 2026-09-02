import { describe, it, expect } from 'vitest'
import { AI_VOICE_DEFAULTS } from '@/lib/ai/types'
import type { AiConfig } from '@/lib/ai/types'
import { canLiveAiRealtime } from './live-ai-ready'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyUnlimited: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...AI_VOICE_DEFAULTS,
    ...overrides,
  }
}

describe('canLiveAiRealtime', () => {
  it('is true for an OpenAI Chat Agent key without ElevenLabs', () => {
    expect(
      canLiveAiRealtime(
        config({
          elevenlabsApiKey: null,
          sttEnabled: false,
          ttsEnabled: false,
        }),
      ),
    ).toBe(true)
  })

  it('is false for Anthropic-only accounts', () => {
    expect(canLiveAiRealtime(config({ provider: 'anthropic' }))).toBe(false)
  })

  it('is false without a key or config', () => {
    expect(canLiveAiRealtime(null)).toBe(false)
    expect(canLiveAiRealtime(config({ apiKey: '  ' }))).toBe(false)
  })
})
