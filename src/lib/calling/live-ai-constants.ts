export const TRANSFER_TO_HUMAN_TOOL = 'transfer_to_human'
export const SEARCH_KNOWLEDGE_TOOL = 'search_knowledge'
export const SEARCH_CUSTOMER_MEMORY_TOOL = 'search_customer_memory'

/** Same v3 model as WhatsApp voice notes. Flash rejects Indic `language_code`. */
export const LIVE_AI_TTS_MODEL = 'eleven_v3'
export const LIVE_AI_SPEAK_MAX_CHARS = 800

export const LIVE_AI_HANDOFF_SPOKEN =
  "I'm connecting you with a teammate now. Please stay on the line."

/** Spoken handoff when the call is locked to Malayalam. */
export const LIVE_AI_HANDOFF_SPOKEN_ML =
  'ഒരു ടീംമേറ്റിനെ ഇപ്പോൾ കണക്റ്റ് ചെയ്യുന്നു. ലൈനിൽ നിൽക്കൂ.'

/** Latest Realtime input-transcription model (replaces gpt-4o-mini-transcribe). */
export const LIVE_AI_TRANSCRIBE_MODEL = 'gpt-live-transcribe'

export const LIVE_AI_TRANSCRIBE_PROMPT =
  'WhatsApp shop voice call. Callers often speak Kerala Malayalam or Manglish. Transcribe Malayalam in Malayalam script and Manglish in Latin letters. Keep product names, SKUs, and prices as spoken.'

/**
 * gpt-live-transcribe uses `languages` (not `language`).
 * Malayalam calls also hint English for Manglish / product names.
 */
export function buildLiveAiTranscription(language?: string | null): Record<string, unknown> {
  const iso = language?.trim().toLowerCase() || ''
  const transcription: Record<string, unknown> = {
    model: LIVE_AI_TRANSCRIBE_MODEL,
    delay: iso === 'ml' ? 'medium' : 'low',
    prompt: LIVE_AI_TRANSCRIBE_PROMPT,
  }
  if (iso === 'ml') transcription.languages = ['ml', 'en']
  else if (iso === 'en') transcription.languages = ['en']
  else if (iso) transcription.languages = [iso, 'en']
  return transcription
}

/** Auto-reply when the caller stops speaking. Sent on session create and session.update. */
export const LIVE_AI_TURN_DETECTION = {
  type: 'server_vad' as const,
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 600,
  create_response: true,
  interrupt_response: true,
}
