import type { SupabaseClient } from '@supabase/supabase-js'
import { accountMayUseAi } from '@/lib/billing/entitlements'
import type { AiConfig } from './types'
import { parseRealtimeVoice } from './realtime/voices'
import {
  parseSarvamLanguage,
  parseSarvamPace,
  parseSarvamSpeaker,
  parseSarvamTemperature,
  parseVoiceReplyMode,
} from './voice'
import {
  chatKeyForProvider,
  loadAccountPlatformFlags,
  loadPlatformAiSettings,
} from './platform-settings'

interface AiConfigRow {
  provider: 'openai' | 'anthropic'
  model: string
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  auto_reply_unlimited: boolean | null
  handoff_agent_id: string | null
  embeddings_api_key: string | null
  elevenlabs_api_key: string | null
  elevenlabs_voice_id: string | null
  voice_provider: string | null
  sarvam_api_key: string | null
  sarvam_speaker: string | null
  sarvam_language_code: string | null
  sarvam_pace: number | null
  sarvam_temperature: number | null
  stt_enabled: boolean | null
  tts_enabled: boolean | null
  voice_reply_mode: string | null
  typing_indicator_enabled: boolean | null
  full_agent_enabled: boolean | null
  realtime_voice_enabled: boolean | null
  realtime_voice: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_unlimited, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key, elevenlabs_api_key, elevenlabs_voice_id, voice_provider, sarvam_api_key, sarvam_speaker, sarvam_language_code, sarvam_pace, sarvam_temperature, stt_enabled, tts_enabled, voice_reply_mode, typing_indicator_enabled, full_agent_enabled, realtime_voice_enabled, realtime_voice'

/**
 * Load the account's AI behaviour plus hosted platform keys.
 * Chat/voice/embeddings keys come only from `platform_ai_settings`.
 * Returns `null` when the account row is missing, the master switch is
 * off, platform AI is off, the account is suspended, or the chat key is
 * not configured.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null

  const platform = await loadPlatformAiSettings()
  if (!platform || !platform.globalAiEnabled) return null

  const flags = await loadAccountPlatformFlags(accountId)
  if (!flags || flags.status === 'suspended' || !flags.aiEnabled) return null

  if (requireActive && !(await accountMayUseAi(accountId))) return null

  const provider = platform.chatProvider
  const apiKey = chatKeyForProvider(platform, provider)
  if (!apiKey) return null

  const embeddingsApiKey = platform.embeddingsApiKey
  const elevenlabsApiKey = platform.elevenlabsApiKey
  const sarvamApiKey = platform.sarvamApiKey

  return {
    provider,
    model: platform.chatModel,
    apiKey,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyUnlimited: row.auto_reply_unlimited === true,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    elevenlabsApiKey,
    elevenlabsVoiceId: row.elevenlabs_voice_id?.trim() || null,
    voiceProvider: platform.voiceProvider,
    sarvamApiKey,
    sarvamSpeaker: parseSarvamSpeaker(row.sarvam_speaker),
    sarvamLanguageCode: parseSarvamLanguage(row.sarvam_language_code),
    sarvamPace: parseSarvamPace(row.sarvam_pace),
    sarvamTemperature: parseSarvamTemperature(row.sarvam_temperature),
    sttEnabled: row.stt_enabled !== false,
    ttsEnabled: row.tts_enabled !== false,
    voiceReplyMode: parseVoiceReplyMode(row.voice_reply_mode),
    typingIndicatorEnabled: row.typing_indicator_enabled !== false,
    fullAgentEnabled: row.full_agent_enabled === true,
    realtimeVoiceEnabled: row.realtime_voice_enabled === true,
    realtimeVoice: parseRealtimeVoice(row.realtime_voice),
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  _db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const platform = await loadPlatformAiSettings()
  if (!platform || !platform.globalAiEnabled) {
    return { key: null, corrupt: false }
  }
  const flags = await loadAccountPlatformFlags(accountId)
  if (!flags || flags.status === 'suspended' || !flags.aiEnabled) {
    return { key: null, corrupt: false }
  }
  if (!(await accountMayUseAi(accountId))) {
    return { key: null, corrupt: false }
  }
  return { key: platform.embeddingsApiKey, corrupt: false }
}
