import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiProvider, VoiceProvider } from './types'
import { supabaseAdmin } from './admin-client'
import { AI_PROVIDER_DEFAULT_MODEL } from './defaults'

export interface PlatformAiSettings {
  globalAiEnabled: boolean
  chatProvider: AiProvider
  chatModel: string
  voiceProvider: VoiceProvider
  openaiApiKey: string | null
  anthropicApiKey: string | null
  openrouterApiKey: string | null
  embeddingsApiKey: string | null
  elevenlabsApiKey: string | null
  sarvamApiKey: string | null
}

const CACHE_MS = 30_000
let cached: { at: number; value: PlatformAiSettings | null } | null = null

function decryptOptional(value: string | null | undefined, label: string): string | null {
  if (!value) return null
  try {
    return decrypt(value)
  } catch {
    console.error(
      `[platform ai] ${label} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return null
  }
}

export function __resetPlatformAiSettingsCache() {
  cached = null
}

export async function loadPlatformAiSettings(): Promise<PlatformAiSettings | null> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.value

  const { data, error } = await supabaseAdmin()
    .from('platform_ai_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle()

  if (error) {
    console.error('[platform ai] failed to load settings:', error)
    cached = { at: now, value: null }
    return null
  }
  if (!data) {
    cached = { at: now, value: null }
    return null
  }

  const chatProvider =
    data.chat_provider === 'anthropic'
      ? 'anthropic'
      : data.chat_provider === 'openrouter'
        ? 'openrouter'
        : 'openai'
  const value: PlatformAiSettings = {
    globalAiEnabled: data.global_ai_enabled !== false,
    chatProvider,
    chatModel:
      typeof data.chat_model === 'string' && data.chat_model.trim()
        ? data.chat_model.trim()
        : AI_PROVIDER_DEFAULT_MODEL[chatProvider],
    voiceProvider: data.voice_provider === 'sarvam' ? 'sarvam' : 'elevenlabs',
    openaiApiKey: decryptOptional(data.openai_api_key, 'OpenAI key'),
    anthropicApiKey: decryptOptional(data.anthropic_api_key, 'Anthropic key'),
    openrouterApiKey: decryptOptional(data.openrouter_api_key, 'OpenRouter key'),
    embeddingsApiKey: decryptOptional(data.embeddings_api_key, 'embeddings key'),
    elevenlabsApiKey: decryptOptional(data.elevenlabs_api_key, 'ElevenLabs key'),
    sarvamApiKey: decryptOptional(data.sarvam_api_key, 'Sarvam key'),
  }
  cached = { at: now, value }
  return value
}

export function chatKeyForProvider(
  settings: PlatformAiSettings,
  provider: AiProvider,
): string | null {
  if (provider === 'anthropic') return settings.anthropicApiKey
  if (provider === 'openrouter') return settings.openrouterApiKey
  return settings.openaiApiKey
}

export type PlatformKeyResult =
  | { ok: true; apiKey: string }
  | { ok: false; error: string; code: string }

function platformOff(): PlatformKeyResult {
  return {
    ok: false,
    error: 'Platform AI is turned off.',
    code: 'platform_ai_off',
  }
}

export async function requirePlatformChatKey(
  provider?: AiProvider,
): Promise<PlatformKeyResult> {
  const platform = await loadPlatformAiSettings()
  if (!platform || !platform.globalAiEnabled) return platformOff()
  const next = provider ?? platform.chatProvider
  const apiKey = chatKeyForProvider(platform, next)
  if (!apiKey) {
    const label =
      next === 'anthropic' ? 'Anthropic' : next === 'openrouter' ? 'OpenRouter' : 'OpenAI'
    return {
      ok: false,
      error: `${label} is not configured by the platform administrator.`,
      code: 'ai_not_configured',
    }
  }
  return { ok: true, apiKey }
}

export async function requirePlatformElevenLabsKey(): Promise<PlatformKeyResult> {
  const platform = await loadPlatformAiSettings()
  if (!platform || !platform.globalAiEnabled) return platformOff()
  if (!platform.elevenlabsApiKey) {
    return {
      ok: false,
      error: 'ElevenLabs is not configured by the platform administrator.',
      code: 'voice_not_configured',
    }
  }
  return { ok: true, apiKey: platform.elevenlabsApiKey }
}

export async function requirePlatformSarvamKey(): Promise<PlatformKeyResult> {
  const platform = await loadPlatformAiSettings()
  if (!platform || !platform.globalAiEnabled) return platformOff()
  if (!platform.sarvamApiKey) {
    return {
      ok: false,
      error: 'Sarvam is not configured by the platform administrator.',
      code: 'voice_not_configured',
    }
  }
  return { ok: true, apiKey: platform.sarvamApiKey }
}

export interface AccountPlatformFlags {
  status: 'active' | 'suspended'
  aiEnabled: boolean
}

export async function loadAccountPlatformFlags(
  accountId: string,
): Promise<AccountPlatformFlags | null> {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('status, ai_enabled')
    .eq('id', accountId)
    .maybeSingle()
  if (error || !data) return null
  return {
    status: data.status === 'suspended' ? 'suspended' : 'active',
    aiEnabled: data.ai_enabled !== false,
  }
}
