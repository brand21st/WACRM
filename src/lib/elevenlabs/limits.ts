/** Supported input MIME types for speech-to-text. WhatsApp voice notes
 *  arrive as `audio/ogg; codecs=opus`; the playground records WebM or
 *  MP4 depending on the browser. */
export const STT_ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/opus',
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/flac',
  'audio/x-flac',
  'audio/3gpp',
])

/** WhatsApp / chat-media ceiling. Also the playground upload cap. */
export const STT_MAX_BYTES = 16 * 1024 * 1024

/** Per-call timeout for STT and TTS. Override with `ELEVENLABS_TIMEOUT_MS`. */
const DEFAULT_TIMEOUT_MS = 30_000

export function elevenLabsTimeoutMs(): number {
  const raw = Number(process.env.ELEVENLABS_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

export function normalizeAudioMime(value?: string | null): string | null {
  if (!value) return null
  const base = value.split(';')[0].trim().toLowerCase()
  return base.includes('/') ? base : null
}

export function isAllowedSttMime(mime: string | null): boolean {
  if (!mime) return false
  if (STT_ALLOWED_MIME_TYPES.has(mime)) return true
  // Browsers often send `audio/webm;codecs=opus` — already stripped —
  // or `video/webm` for MediaRecorder audio-only. Accept webm either
  // way; ElevenLabs still transcribes it.
  return mime === 'video/webm'
}

export function extensionForAudioMime(mime: string): string {
  if (mime.includes('ogg') || mime.includes('opus')) return 'ogg'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mpeg') || mime === 'audio/mp3') return 'mp3'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('aac')) return 'aac'
  if (mime.includes('flac')) return 'flac'
  if (mime.includes('3gpp')) return '3gp'
  return 'bin'
}
