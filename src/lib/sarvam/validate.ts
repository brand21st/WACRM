import { textToSpeech } from './tts'

const PING_TEXT = 'Hello'

/**
 * Cheap liveness + auth check against Sarvam. Throws `AiError` on
 * failure, resolves on success. A short English TTS ping — no extra
 * endpoint required.
 */
export async function validateSarvamKey(
  apiKey: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  await textToSpeech({
    apiKey,
    text: PING_TEXT,
    languageCode: 'en-IN',
    speaker: 'shubh',
    outputAudioCodec: 'mp3',
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
  })
}
