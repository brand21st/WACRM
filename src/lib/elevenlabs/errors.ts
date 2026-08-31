import { AiError } from '@/lib/ai/types'

/**
 * Map a fetch rejection (timeout / DNS / offline) to a typed AiError
 * so settings and the playground can branch the same way they do for
 * OpenAI/Anthropic.
 */
export function toElevenLabsNetworkError(err: unknown): AiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError('ElevenLabs took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(`Could not reach ElevenLabs: ${msg}`, {
    code: 'network_error',
    status: 502,
  })
}

/**
 * Build a typed AiError from a non-2xx ElevenLabs response. The
 * provider's JSON body is `{ detail: { status, message } }` or a
 * string `detail`.
 */
export async function elevenLabsHttpError(res: Response): Promise<AiError> {
  let detail = ''
  try {
    const body = (await res.json()) as {
      detail?:
        | string
        | { message?: string; status?: string }
        | Array<{ msg?: string; message?: string }>
    }
    const raw = body?.detail
    if (typeof raw === 'string') {
      detail = raw
    } else if (Array.isArray(raw)) {
      detail = raw
        .map((d) => d.message || d.msg || '')
        .filter(Boolean)
        .join('; ')
    } else if (raw && typeof raw === 'object') {
      detail = raw.message ?? ''
    }
  } catch {
    // Non-JSON error body — fall back to the status line.
  }

  const { status } = res
  const code =
    status === 401 || status === 403
      ? 'invalid_key'
      : status === 429
        ? 'rate_limited'
        : 'provider_error'
  const base =
    code === 'invalid_key'
      ? 'ElevenLabs rejected the API key'
      : code === 'rate_limited'
        ? 'ElevenLabs rate limit reached'
        : `ElevenLabs API error (${status})`

  return new AiError(detail ? `${base}: ${detail}` : base, {
    code,
    status: code === 'invalid_key' ? 401 : 502,
  })
}
