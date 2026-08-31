import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'
import { parseRealtimeVoice } from './realtime/voices'
import {
  parseSarvamLanguage,
  parseSarvamPace,
  parseSarvamSpeaker,
  parseSarvamTemperature,
  parseVoiceProvider,
  parseVoiceReplyMode,
} from './voice'

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
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
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
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  // Voice keys are optional. A corrupt one disables that provider for
  // this load without taking down chat generation — same posture as
  // the embeddings key.
  let elevenlabsApiKey: string | null = null
  if (row.elevenlabs_api_key) {
    try {
      elevenlabsApiKey = decrypt(row.elevenlabs_api_key)
    } catch {
      console.error(
        `[ai config] ElevenLabs key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; ElevenLabs voice is disabled until it is re-entered.`,
      )
      elevenlabsApiKey = null
    }
  }

  let sarvamApiKey: string | null = null
  if (row.sarvam_api_key) {
    try {
      sarvamApiKey = decrypt(row.sarvam_api_key)
    } catch {
      console.error(
        `[ai config] Sarvam key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; Sarvam voice is disabled until it is re-entered.`,
      )
      sarvamApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyUnlimited: row.auto_reply_unlimited === true,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    elevenlabsApiKey,
    elevenlabsVoiceId: row.elevenlabs_voice_id?.trim() || null,
    voiceProvider: parseVoiceProvider(row.voice_provider),
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
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
