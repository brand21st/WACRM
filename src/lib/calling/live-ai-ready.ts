import type { AiConfig } from '@/lib/ai/types'
import type { LiveAiVoice } from '@/types'
import { canSpeak } from '@/lib/ai/speech'

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

/** Speak live-call replies with the Voice Agent TTS voice (ElevenLabs/Sarvam). */
export function usesLiveTtsVoice(
  config: AiConfig | null | undefined,
  voice?: LiveAiVoice | null,
): boolean {
  if (voice === 'openai') return false
  return Boolean(config && canLiveAiRealtime(config) && canSpeak(config))
}

export const LIVE_AI_NOT_READY_MESSAGE =
  'Live AI answering needs an active OpenAI Chat Agent key (Realtime voice). Anthropic-only accounts cannot answer live calls.'
