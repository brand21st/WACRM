import type { AiConfig, VoiceProvider, VoiceReplyMode } from './types'

/** ElevenLabs example voice (George). Used when the account left
 *  `elevenlabs_voice_id` blank. */
export const DEFAULT_ELEVENLABS_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'

export type InboundModality = 'text' | 'audio' | 'image'
export type ReplyChannel = 'text' | 'audio'

/** Persisted when STT returns nothing so auto-reply still has a turn. */
export const INBOUND_VOICE_PLACEHOLDER = '[Customer sent a voice note]'

const VOICE_REPLY_MODES: ReadonlySet<string> = new Set([
  'same',
  'text',
  'audio',
  'both',
])

export function parseVoiceReplyMode(value: unknown): VoiceReplyMode {
  return typeof value === 'string' && VOICE_REPLY_MODES.has(value)
    ? (value as VoiceReplyMode)
    : 'same'
}

export function effectiveVoiceId(voiceId: string | null | undefined): string {
  const trimmed = typeof voiceId === 'string' ? voiceId.trim() : ''
  return trimmed || DEFAULT_ELEVENLABS_VOICE_ID
}

export const DEFAULT_SARVAM_SPEAKER = 'shubh'
export const DEFAULT_SARVAM_LANGUAGE = 'en-IN'
export const DEFAULT_SARVAM_PACE = 1
export const DEFAULT_SARVAM_TEMPERATURE = 0.6

export function parseVoiceProvider(value: unknown): VoiceProvider {
  return value === 'sarvam' ? 'sarvam' : 'elevenlabs'
}

export function parseSarvamSpeaker(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || DEFAULT_SARVAM_SPEAKER
}

export function parseSarvamLanguage(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || DEFAULT_SARVAM_LANGUAGE
}

export function parseSarvamPace(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SARVAM_PACE
  return Math.min(2, Math.max(0.5, n))
}

export function parseSarvamTemperature(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_SARVAM_TEMPERATURE
  return Math.min(2, Math.max(0.01, n))
}

/** True when the selected speech provider has a usable BYO key. */
export function hasSpeechKey(
  config: Pick<AiConfig, 'voiceProvider' | 'elevenlabsApiKey' | 'sarvamApiKey'>,
): boolean {
  return config.voiceProvider === 'sarvam'
    ? Boolean(config.sarvamApiKey)
    : Boolean(config.elevenlabsApiKey)
}

/**
 * Which outbound channels to use for one auto-reply, given the account
 * `voice_reply_mode` and the inbound message's modality.
 *
 * `text` / `audio` / `both` are explicit. `same` mirrors inbound
 * (a voice note gets a voice note; text and images get text).
 */
export function resolveReplyChannels(
  mode: VoiceReplyMode,
  inbound: InboundModality,
): ReplyChannel[] {
  switch (mode) {
    case 'text':
      return ['text']
    case 'audio':
      return ['audio']
    case 'both':
      return ['text', 'audio']
    case 'same':
    default:
      return inbound === 'audio' ? ['audio'] : ['text']
  }
}

/**
 * True when this inbound row still needs speech-to-text. Audio that
 * already has `content_text` (a prior STT pass, or a webhook replay
 * that somehow re-entered) is left alone.
 */
export function needsTranscription(
  contentType: string,
  contentText: string | null | undefined,
): boolean {
  return contentType === 'audio' && !contentText?.trim()
}
