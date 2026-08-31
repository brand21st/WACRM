/** Per-call timeout for Sarvam STT/TTS. Override with `SARVAM_TIMEOUT_MS`. */
const DEFAULT_TIMEOUT_MS = 30_000

export function sarvamTimeoutMs(): number {
  const raw = Number(process.env.SARVAM_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

export const SARVAM_STT_URL = 'https://api.sarvam.ai/speech-to-text'
export const SARVAM_TTS_URL = 'https://api.sarvam.ai/text-to-speech'
export const SARVAM_STT_MODEL = 'saaras:v3'
export const SARVAM_TTS_MODEL = 'bulbul:v3'
export const SARVAM_TTS_MAX_CHARS = 2500
export const SARVAM_WHATSAPP_CODEC = 'opus'
/**
 * OPUS only accepts 8 / 12 / 16 / 24 / 48 kHz. Sarvam's default
 * (22050) is valid for mp3/wav but 400s the WhatsApp voice-note path.
 */
export const SARVAM_WHATSAPP_SAMPLE_RATE = 24_000
export const SARVAM_PREVIEW_CODEC = 'mp3'
export const SARVAM_TTS_MIME_MP3 = 'audio/mpeg'
export const SARVAM_TTS_MIME_OPUS = 'audio/ogg'
export const SARVAM_TTS_MIME_WAV = 'audio/wav'
