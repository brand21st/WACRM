/** OpenAI Realtime output voices. Null/unknown → application default. */
export const REALTIME_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
  'cedar',
] as const

export type RealtimeVoice = (typeof REALTIME_VOICES)[number]

export const DEFAULT_REALTIME_VOICE: RealtimeVoice = 'marin'

const VOICE_SET: ReadonlySet<string> = new Set(REALTIME_VOICES)

export function parseRealtimeVoice(value: unknown): RealtimeVoice | null {
  return typeof value === 'string' && VOICE_SET.has(value)
    ? (value as RealtimeVoice)
    : null
}

export function effectiveRealtimeVoice(
  voice: string | null | undefined,
): RealtimeVoice {
  return parseRealtimeVoice(voice) ?? DEFAULT_REALTIME_VOICE
}
