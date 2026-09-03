import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_VOICE_DEFAULTS } from './types'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

vi.mock('./platform-settings', () => ({
  loadPlatformAiSettings: vi.fn(async () => ({
    globalAiEnabled: true,
    chatProvider: 'openai',
    chatModel: 'gpt-x',
    voiceProvider: 'elevenlabs',
    openaiApiKey: 'plain:enc-key',
    anthropicApiKey: null,
    embeddingsApiKey: null,
    elevenlabsApiKey: null,
    sarvamApiKey: null,
  })),
  loadAccountPlatformFlags: vi.fn(async () => ({
    status: 'active',
    aiEnabled: true,
  })),
  chatKeyForProvider: (
    settings: { openaiApiKey: string | null; anthropicApiKey: string | null },
    provider: string,
  ) => (provider === 'anthropic' ? settings.anthropicApiKey : settings.openaiApiKey),
}))

vi.mock('@/lib/billing/entitlements', () => ({
  accountMayUseAi: vi.fn(async () => true),
}))

import { loadAiConfig } from './config'
import { loadPlatformAiSettings } from './platform-settings'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  auto_reply_unlimited: false,
  embeddings_api_key: null,
  elevenlabs_api_key: null,
  elevenlabs_voice_id: null,
  stt_enabled: true,
  tts_enabled: true,
  voice_reply_mode: 'same',
  typing_indicator_enabled: true,
  full_agent_enabled: false,
  realtime_voice_enabled: false,
  realtime_voice: null,
}

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.elevenlabsApiKey).toBeNull()
    expect(config!.voiceReplyMode).toBe('same')
    expect(config!.sttEnabled).toBe(true)
    expect(config!.ttsEnabled).toBe(true)
    expect(config!.typingIndicatorEnabled).toBe(true)
  })

  it('uses platform keys instead of the account row', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, is_active: true, sarvam_api_key: 'enc-sv' }),
      'acct',
    )
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.sarvamApiKey).toBeNull()
    expect(config!.voiceProvider).toBe('elevenlabs')
  })

  it('still maps account voice speaker settings', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        is_active: true,
        voice_provider: 'sarvam',
        sarvam_speaker: 'priya',
        sarvam_language_code: 'hi-IN',
      }),
      'acct',
    )
    expect(config!.sarvamSpeaker).toBe('priya')
    expect(config!.sarvamLanguageCode).toBe('hi-IN')
  })

  it('falls back to same when voice_reply_mode is unknown', async () => {
    const config = await loadAiConfig(
      dbReturning({ ...ROW, is_active: true, voice_reply_mode: 'nope' }),
      'acct',
    )
    expect(config!.voiceReplyMode).toBe('same')
  })

  it('defaults typing on when the column is missing', async () => {
    const { typing_indicator_enabled: _omit, ...without } = ROW
    void _omit
    const config = await loadAiConfig(
      dbReturning({ ...without, is_active: true }),
      'acct',
    )
    expect(config!.typingIndicatorEnabled).toBe(true)
  })

  it('maps typing_indicator_enabled false', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        is_active: true,
        typing_indicator_enabled: false,
      }),
      'acct',
    )
    expect(config!.typingIndicatorEnabled).toBe(false)
  })

  it('maps full_agent_enabled true', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        is_active: true,
        full_agent_enabled: true,
      }),
      'acct',
    )
    expect(config!.fullAgentEnabled).toBe(true)
  })

  it('maps realtime_voice_enabled and a known voice', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        is_active: true,
        realtime_voice_enabled: true,
        realtime_voice: 'alloy',
      }),
      'acct',
    )
    expect(config!.realtimeVoiceEnabled).toBe(true)
    expect(config!.realtimeVoice).toBe('alloy')
  })

  it('maps auto_reply_unlimited true', async () => {
    const config = await loadAiConfig(
      dbReturning({
        ...ROW,
        is_active: true,
        auto_reply_unlimited: true,
      }),
      'acct',
    )
    expect(config!.autoReplyUnlimited).toBe(true)
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })

  it('returns null when platform AI is off', async () => {
    vi.mocked(loadPlatformAiSettings).mockResolvedValueOnce(null)
    expect(
      await loadAiConfig(dbReturning({ ...ROW, is_active: true }), 'acct'),
    ).toBeNull()
  })
})

// Keep the defaults object from drifting away from the loader.
describe('AI_VOICE_DEFAULTS', () => {
  it('defaults to match-inbound replies with STT/TTS on', () => {
    expect(AI_VOICE_DEFAULTS).toEqual({
      elevenlabsApiKey: null,
      elevenlabsVoiceId: null,
      voiceProvider: 'elevenlabs',
      sarvamApiKey: null,
      sarvamSpeaker: 'shubh',
      sarvamLanguageCode: 'en-IN',
      sarvamPace: 1,
      sarvamTemperature: 0.6,
      sttEnabled: true,
      ttsEnabled: true,
      voiceReplyMode: 'same',
      typingIndicatorEnabled: true,
      fullAgentEnabled: false,
      realtimeVoiceEnabled: false,
      realtimeVoice: null,
    })
  })
})

