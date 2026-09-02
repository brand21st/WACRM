import type { CallStatus } from '@/types'

/**
 * Thread / conversation-list preview for a call bubble.
 *
 * Stored as `call:<status>` or `call:completed:<durationSeconds>` so
 * the inbox can translate without a join on `calls`.
 */
export function encodeCallPreview(
  status: CallStatus,
  durationSeconds?: number | null,
): string {
  if (status === 'completed' && durationSeconds != null && durationSeconds >= 0) {
    return `call:completed:${durationSeconds}`
  }
  return `call:${status}`
}

export function parseCallPreview(text: string | null | undefined): {
  status: CallStatus
  durationSeconds: number | null
} | null {
  if (!text || !text.startsWith('call:')) return null
  const rest = text.slice('call:'.length)
  const [statusPart, durationPart] = rest.split(':')
  const status = statusPart as CallStatus
  const known: CallStatus[] = [
    'ringing',
    'connecting',
    'in_progress',
    'completed',
    'missed',
    'rejected',
    'failed',
  ]
  if (!known.includes(status)) return null
  const duration =
    durationPart != null && durationPart !== ''
      ? Number.parseInt(durationPart, 10)
      : null
  return {
    status,
    durationSeconds: Number.isFinite(duration) ? duration : null,
  }
}

export function formatCallDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function callListPreview(
  text: string | null | undefined,
  labels: {
    incoming: string
    missed: string
    completed: (duration: string) => string
    completedUnknown: string
    rejected: string
    failed: string
    inProgress: string
  },
): string | null {
  const parsed = parseCallPreview(text)
  if (!parsed) return null
  switch (parsed.status) {
    case 'completed':
      return parsed.durationSeconds != null
        ? labels.completed(formatCallDuration(parsed.durationSeconds))
        : labels.completedUnknown
    case 'rejected':
      return labels.rejected
    case 'failed':
      return labels.failed
    case 'in_progress':
      return labels.inProgress
    case 'missed':
      return labels.missed
    default:
      return labels.incoming
  }
}
