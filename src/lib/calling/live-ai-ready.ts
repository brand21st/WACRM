import type { AiConfig } from '@/lib/ai/types'

/**
 * Live AI calls use OpenAI Realtime (speech-to-speech). ElevenLabs
 * STT/TTS is not required. Anthropic-only accounts cannot answer.
 */
export function canLiveAiRealtime(config: AiConfig | null | undefined): boolean {
  return Boolean(
    config &&
      config.provider === 'openai' &&
      typeof config.apiKey === 'string' &&
      config.apiKey.trim().length > 0,
  )
}

export const LIVE_AI_NOT_READY_MESSAGE =
  'Live AI answering needs an active OpenAI Chat Agent key (Realtime voice). Anthropic-only accounts cannot answer live calls.'
