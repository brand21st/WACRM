import { elevenLabsHttpError, toElevenLabsNetworkError } from './errors'
import { elevenLabsTimeoutMs } from './limits'

// Voices listing works with restricted keys that lack `user_read`
// (the /v1/user endpoint requires that permission and would reject
// otherwise-valid STT/TTS keys).
const VALIDATE_URL = 'https://api.elevenlabs.io/v1/voices?page_size=1'

/**
 * Cheap liveness + auth check against ElevenLabs. Throws `AiError`
 * (invalid_key / rate_limited / network / timeout) on failure, resolves
 * on success. Used by the settings "Test voice" button and before
 * persisting a key.
 */
export async function validateElevenLabsKey(
  apiKey: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? elevenLabsTimeoutMs()
  const fetchImpl = opts.fetchImpl ?? fetch
  let res: Response
  try {
    res = await fetchImpl(VALIDATE_URL, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toElevenLabsNetworkError(err)
  }
  if (!res.ok) throw await elevenLabsHttpError(res)
}
