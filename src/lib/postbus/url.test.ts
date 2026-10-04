import { describe, expect, it } from 'vitest'

import { parsePostBusApiBaseUrl } from './url'

describe('parsePostBusApiBaseUrl', () => {
  it('accepts empty as unset', () => {
    expect(parsePostBusApiBaseUrl('')).toEqual({ ok: true, url: '' })
    expect(parsePostBusApiBaseUrl(null)).toEqual({ ok: true, url: '' })
  })

  it('accepts a public HTTPS origin', () => {
    const result = parsePostBusApiBaseUrl('https://api.postbus.example/v1/')
    expect(result).toEqual({
      ok: true,
      url: 'https://api.postbus.example/v1',
    })
  })

  it('rejects http and private hosts', () => {
    expect(parsePostBusApiBaseUrl('http://api.example.com').ok).toBe(false)
    expect(parsePostBusApiBaseUrl('https://localhost/api').ok).toBe(false)
    expect(parsePostBusApiBaseUrl('https://127.0.0.1/api').ok).toBe(false)
    expect(parsePostBusApiBaseUrl('https://192.168.1.9/api').ok).toBe(false)
    expect(parsePostBusApiBaseUrl('not-a-url').ok).toBe(false)
  })
})
