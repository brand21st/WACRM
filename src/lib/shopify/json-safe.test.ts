import { describe, expect, it } from 'vitest'
import { jsonSafeText, jsonSafeValue } from './json-safe'

describe('jsonSafeText', () => {
  it('keeps valid emoji pairs', () => {
    expect(jsonSafeText('Kitchen 💧 Set')).toBe('Kitchen 💧 Set')
  })

  it('strips unpaired surrogates that Postgres json rejects', () => {
    const broken = `Socks${String.fromCharCode(0xd83d)} pack`
    expect(broken.includes(String.fromCharCode(0xd83d))).toBe(true)
    const safe = jsonSafeText(broken)
    expect(safe).toBe('Socks pack')
    expect(safe.includes(String.fromCharCode(0xd83d))).toBe(false)
  })
})

describe('jsonSafeValue', () => {
  it('sanitizes nested strings', () => {
    const broken = String.fromCharCode(0xd83d)
    const safe = jsonSafeValue({
      title: `Hi${broken}`,
      variants: [{ title: `${broken}Blue` }],
    })
    expect(safe).toEqual({ title: 'Hi', variants: [{ title: 'Blue' }] })
  })
})
