import { describe, expect, it, vi } from 'vitest'
import { GET } from './route'

describe('GET /api/geo/country', () => {
  it('returns the Cloudflare country header', async () => {
    const res = await GET(
      new Request('https://app.test/api/geo/country', {
        headers: { 'cf-ipcountry': 'IN' },
      }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ iso2: 'IN', source: 'header' })
  })

  it('looks up a public IP when no geo header is present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ country: 'AE' }),
      }),
    )
    const res = await GET(
      new Request('https://app.test/api/geo/country', {
        headers: { 'x-forwarded-for': '1.2.3.4' },
      }),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ iso2: 'AE', source: 'ip' })
    vi.unstubAllGlobals()
  })

  it('returns none for localhost without headers', async () => {
    const res = await GET(new Request('https://app.test/api/geo/country'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ iso2: null, source: 'none' })
  })
})
