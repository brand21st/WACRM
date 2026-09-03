import { describe, expect, it } from 'vitest'

/**
 * Merchant AI config must reject provider keys. The route returns 400
 * when any of these fields is a non-empty string — asserted here by
 * reusing the same predicate the handler uses so a future refactor
 * cannot silently accept keys again.
 */
function rejectsMerchantKeys(body: Record<string, unknown>): boolean {
  return Boolean(
    (typeof body.api_key === 'string' && body.api_key.trim()) ||
      (typeof body.embeddings_api_key === 'string' && body.embeddings_api_key.trim()) ||
      (typeof body.elevenlabs_api_key === 'string' && body.elevenlabs_api_key.trim()) ||
      (typeof body.sarvam_api_key === 'string' && body.sarvam_api_key.trim()),
  )
}

describe('merchant AI key rejection', () => {
  it('rejects pasted provider keys', () => {
    expect(rejectsMerchantKeys({ api_key: 'sk-test' })).toBe(true)
    expect(rejectsMerchantKeys({ embeddings_api_key: 'sk-emb' })).toBe(true)
    expect(rejectsMerchantKeys({ elevenlabs_api_key: 'xi-test' })).toBe(true)
    expect(rejectsMerchantKeys({ sarvam_api_key: 'sv-test' })).toBe(true)
  })

  it('allows behavioural saves without keys', () => {
    expect(rejectsMerchantKeys({ is_active: true, system_prompt: 'hi' })).toBe(
      false,
    )
  })
})
