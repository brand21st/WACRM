import { AiError } from '@/lib/ai/types'

/**
 * Map a fetch rejection (timeout / DNS / offline) to a typed AiError.
 */
export function toSarvamNetworkError(err: unknown): AiError {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new AiError('Sarvam took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }
  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(`Could not reach Sarvam: ${msg}`, {
    code: 'network_error',
    status: 502,
  })
}

/**
 * Build a typed AiError from a non-2xx Sarvam response.
 * Auth failures are HTTP 403 with `error.code: invalid_api_key_error`.
 */
export async function sarvamHttpError(res: Response): Promise<AiError> {
  let detail = ''
  let errorCode = ''
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string } | string
      message?: string
    }
    if (typeof body?.error === 'string') {
      detail = body.error
    } else if (body?.error && typeof body.error === 'object') {
      errorCode = body.error.code ?? ''
      detail = body.error.message ?? ''
    } else if (typeof body?.message === 'string') {
      detail = body.message
    }
  } catch {
    // Non-JSON error body — fall back to the status line.
  }

  const { status } = res
  const invalidKey =
    status === 401 ||
    status === 403 ||
    errorCode === 'invalid_api_key_error'
  const code = invalidKey
    ? 'invalid_key'
    : status === 429
      ? 'rate_limited'
      : 'provider_error'
  const base =
    code === 'invalid_key'
      ? 'Sarvam rejected the API key'
      : code === 'rate_limited'
        ? 'Sarvam rate limit reached'
        : `Sarvam API error (${status})`

  return new AiError(detail ? `${base}: ${detail}` : base, {
    code,
    status: code === 'invalid_key' ? 401 : 502,
  })
}
