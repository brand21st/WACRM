const BUCKET = 'call-recordings'

/** Exact-match list on the call-recordings bucket (migration 053). */
const ALLOWED_RECORDING_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'video/webm',
])

export function recordingObjectPath(
  accountId: string,
  callId: string,
  ext = 'webm',
): string {
  const safeExt = ext.replace(/[^a-z0-9]/gi, '') || 'webm'
  return `account-${accountId}/${callId}.${safeExt}`
}

/**
 * Storage `allowed_mime_types` is an exact-match list. MediaRecorder
 * sends `audio/webm;codecs=opus` (or `audio/ogg; codecs=opus`); that
 * 400s the upload unless we drop the parameters first.
 */
export function recordingContentType(value?: string | null): string {
  const base = value?.split(';')[0]?.trim().toLowerCase() ?? ''
  return ALLOWED_RECORDING_MIME.has(base) ? base : 'audio/webm'
}

export { BUCKET as CALL_RECORDINGS_BUCKET }
