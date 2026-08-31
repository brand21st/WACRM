// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider = 'openai' | 'anthropic'

/** How WhatsApp auto-replies are delivered when voice is configured. */
export type VoiceReplyMode = 'same' | 'text' | 'audio' | 'both'

/** Which BYO speech layer the Voice Agent uses. */
export type VoiceProvider = 'elevenlabs' | 'sarvam'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  /** When true, no per-thread auto-reply cap is enforced. */
  autoReplyUnlimited: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Optional ElevenLabs key for speech-to-text / text-to-speech.
   *  Independent of the chat provider key. Null when voice is unset. */
  elevenlabsApiKey: string | null
  /** ElevenLabs voice id. Null means the application default. */
  elevenlabsVoiceId: string | null
  /** Which speech provider the runtime uses. */
  voiceProvider: VoiceProvider
  /** Optional Sarvam subscription key. Null when Sarvam is unset. */
  sarvamApiKey: string | null
  /** Bulbul speaker id, or a Studio-cloned speaker. */
  sarvamSpeaker: string
  /** BCP-47 language for Sarvam TTS. */
  sarvamLanguageCode: string
  /** Bulbul v3 pace (0.5–2.0). */
  sarvamPace: number
  /** Bulbul v3 temperature (0.01–2.0). */
  sarvamTemperature: number
  /** Transcribe inbound voice notes and playground recordings. */
  sttEnabled: boolean
  /** Speak auto-replies / playground replies when the reply mode asks
   *  for audio. */
  ttsEnabled: boolean
  /** WhatsApp auto-reply delivery modality. */
  voiceReplyMode: VoiceReplyMode
  /** Show WhatsApp typing dots before an auto-reply is sent. */
  typingIndicatorEnabled: boolean
  /** Fully automated agent: bypass flows/automations; handle images. */
  fullAgentEnabled: boolean
  /** WhatsApp auto-replies use OpenAI Realtime for spoken voice notes. */
  realtimeVoiceEnabled: boolean
  /** OpenAI Realtime output voice. Null uses the application default. */
  realtimeVoice: string | null
}

/**
 * Voice-layer defaults used by tests and by routes that construct a
 * partial `AiConfig` just to ping the chat provider. Also includes the
 * typing-indicator default so those stubs stay a complete `AiConfig`.
 */
export const AI_VOICE_DEFAULTS: Pick<
  AiConfig,
  | 'elevenlabsApiKey'
  | 'elevenlabsVoiceId'
  | 'voiceProvider'
  | 'sarvamApiKey'
  | 'sarvamSpeaker'
  | 'sarvamLanguageCode'
  | 'sarvamPace'
  | 'sarvamTemperature'
  | 'sttEnabled'
  | 'ttsEnabled'
  | 'voiceReplyMode'
  | 'typingIndicatorEnabled'
  | 'fullAgentEnabled'
  | 'realtimeVoiceEnabled'
  | 'realtimeVoice'
> = {
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
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
