import { AiError } from '@/lib/ai/types'

/**
 * Map a Realtime WebSocket / HTTP failure onto the same AiError codes
 * the chat adapters use so auto-reply can fall back cleanly.
 */
export function realtimeError(
  err: unknown,
  fallback = 'OpenAI Realtime failed.',
): AiError {
  if (err instanceof AiError) return err
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError('OpenAI Realtime took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (/invalid.?api.?key|unauthorized|401/i.test(msg)) {
    return new AiError('OpenAI Realtime rejected the API key.', {
      code: 'invalid_key',
      status: 401,
    })
  }
  if (/rate.?limit|429/i.test(msg)) {
    return new AiError('OpenAI Realtime rate-limited this key.', {
      code: 'rate_limited',
      status: 429,
    })
  }
  return new AiError(`${fallback} ${msg}`.trim(), {
    code: 'network_error',
    status: 502,
  })
}

export function realtimeServerError(event: {
  error?: { message?: string; code?: string }
}): AiError {
  const message = event.error?.message || 'OpenAI Realtime returned an error.'
  const code = event.error?.code || ''
  if (/invalid_api_key|unauthorized/i.test(`${code} ${message}`)) {
    return new AiError(message, { code: 'invalid_key', status: 401 })
  }
  if (/rate_limit/i.test(`${code} ${message}`)) {
    return new AiError(message, { code: 'rate_limited', status: 429 })
  }
  return new AiError(message, { code: 'ai_error', status: 502 })
}
