import type { CallingSettings, CallHours, LiveAiAnswer, LiveAiVoice } from '@/types'
import { normalizeLiveAiPromptField } from '@/lib/calling/live-ai-prompt'
import type { SupabaseClient } from '@supabase/supabase-js'

export const LIVE_AI_ANSWER_VALUES = ['off', 'ai_first', 'after_timeout'] as const
export const LIVE_AI_VOICE_VALUES = ['elevenlabs', 'openai'] as const

/** Graph `recording.purpose` when recording is ENABLED. Meta prepends its own prefix. */
export const DEFAULT_RECORDING_PURPOSE = 'quality and training purposes'

export const RECORDING_ANNOUNCEMENT_LANGUAGES = [
  'en',
  'en_US',
  'en_AU',
  'en_CA',
  'en_GB',
  'en_IN',
  'en_NZ',
  'nl',
  'fr',
  'de',
  'hi',
  'it',
  'kn',
  'pt',
  'es',
  'es_ES',
  'te',
  'vi',
] as const

export type RecordingAnnouncementLanguage =
  (typeof RECORDING_ANNOUNCEMENT_LANGUAGES)[number]

const ANNOUNCEMENT_LANGUAGE_SET = new Set<string>(RECORDING_ANNOUNCEMENT_LANGUAGES)

const DEFAULTS = {
  recording_enabled: false,
  announce_recording: true,
  recording_purpose: DEFAULT_RECORDING_PURPOSE,
  recording_announcement_language: 'en_US' as RecordingAnnouncementLanguage,
  retention_days: 30,
  transcribe_enabled: false,
  ai_enabled: false,
  ai_auto_send_followup: false,
  ring_timeout_seconds: 45,
  answer_policy: 'any_agent' as const,
  call_hours: null as CallHours | null,
  call_icon_visibility: 'DEFAULT' as const,
  live_ai_answer: 'off' as LiveAiAnswer,
  live_ai_voice: 'elevenlabs' as LiveAiVoice,
  live_ai_behaviour: null as string | null,
  live_ai_business_context: null as string | null,
  live_ai_instructions: null as string | null,
}

export function parseLiveAiAnswer(value: unknown): LiveAiAnswer {
  return value === 'ai_first' || value === 'after_timeout' ? value : 'off'
}

export function parseLiveAiVoice(value: unknown): LiveAiVoice {
  return value === 'openai' ? 'openai' : 'elevenlabs'
}

export function parseRecordingAnnouncementLanguage(
  value: unknown,
): RecordingAnnouncementLanguage {
  return typeof value === 'string' && ANNOUNCEMENT_LANGUAGE_SET.has(value)
    ? (value as RecordingAnnouncementLanguage)
    : 'en_US'
}

/** Trim and enforce Meta's 1–250 character purpose rule. Empty → null. */
export function sanitizeRecordingPurpose(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const purpose = value.trim()
  if (purpose.length < 1 || purpose.length > 250) return null
  return purpose
}

export function spokenRecordingNotice(purpose: string): string {
  return `The audio of this call will be recorded for the following purpose: ${purpose.trim()}`
}

/** Graph `recording` object for accept, or null when the account opted out. */
export function metaRecordingPayload(
  settings: Pick<
    CallingSettings,
    'recording_enabled' | 'recording_purpose' | 'recording_announcement_language'
  >,
): {
  status: 'ENABLED'
  purpose: string
  announcement_language: string
} | null {
  if (!settings.recording_enabled) return null
  const purpose = sanitizeRecordingPurpose(settings.recording_purpose)
  if (!purpose) return null
  return {
    status: 'ENABLED',
    purpose,
    announcement_language: parseRecordingAnnouncementLanguage(
      settings.recording_announcement_language,
    ),
  }
}

/** Cap auto-answer wait under Meta's ~30–60s accept window. */
export function liveAiTimeoutMs(ringTimeoutSeconds: number): number {
  const sec = Number.isFinite(ringTimeoutSeconds) ? ringTimeoutSeconds : 45
  return Math.min(Math.max(sec, 15), 25) * 1000
}

export function defaultCallingSettings(accountId: string): CallingSettings {
  return {
    account_id: accountId,
    ...DEFAULTS,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
}

export async function loadCallingSettings(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CallingSettings> {
  const { data, error } = await supabase
    .from('calling_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!data) return defaultCallingSettings(accountId)
  return normalizeCallingSettings(data as CallingSettings)
}

export async function ensureCallingSettings(
  supabase: SupabaseClient,
  accountId: string,
): Promise<CallingSettings> {
  const { data, error } = await supabase
    .from('calling_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  if (data) return normalizeCallingSettings(data as CallingSettings)

  const { data: inserted, error: insertError } = await supabase
    .from('calling_settings')
    .insert([{ account_id: accountId, ...DEFAULTS }])
    .select('*')
    .maybeSingle()

  if (insertError) {
    const { data: retry } = await supabase
      .from('calling_settings')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()
    if (retry) return normalizeCallingSettings(retry as CallingSettings)
    throw insertError
  }
  if (!inserted) return defaultCallingSettings(accountId)
  return normalizeCallingSettings(inserted)
}

function normalizeCallingSettings(row: CallingSettings): CallingSettings {
  return {
    ...row,
    live_ai_answer: parseLiveAiAnswer(row.live_ai_answer),
    live_ai_voice: parseLiveAiVoice(row.live_ai_voice),
    live_ai_behaviour: normalizeLiveAiPromptField(row.live_ai_behaviour),
    live_ai_business_context: normalizeLiveAiPromptField(row.live_ai_business_context),
    live_ai_instructions: normalizeLiveAiPromptField(row.live_ai_instructions),
    recording_purpose:
      typeof row.recording_purpose === 'string'
        ? row.recording_purpose
        : DEFAULT_RECORDING_PURPOSE,
    recording_announcement_language: parseRecordingAnnouncementLanguage(
      row.recording_announcement_language,
    ),
  }
}
