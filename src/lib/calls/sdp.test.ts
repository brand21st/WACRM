import { describe, it, expect } from 'vitest'
import { normalizeOfferSdp } from './sdp'

const OFFER = [
  'v=0',
  'o=- 0 0 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=sendrecv',
  'a=rtpmap:111 opus/48000/2',
]

describe('normalizeOfferSdp', () => {
  it('terminates every line including rtpmap with CRLF', () => {
    const lfOnly = OFFER.join('\n')
    const out = normalizeOfferSdp(lfOnly)
    expect(out.endsWith('\r\n')).toBe(true)
    expect(out).toContain('a=rtpmap:111 opus/48000/2\r\n')
    expect(out.split('\r\n').filter(Boolean)).toEqual(OFFER)
  })

  it('strips a dangling CR that Chromium treats as part of rtpmap', () => {
    const danglingCr = `${OFFER.join('\r\n')}\r`
    const out = normalizeOfferSdp(danglingCr)
    expect(out.endsWith('a=rtpmap:111 opus/48000/2\r\n')).toBe(true)
    expect(out.includes('opus/48000/2\r\r')).toBe(false)
  })

  it('unescapes JSON-style \\\\n when no real newlines are present', () => {
    const escaped = OFFER.join('\\n')
    const out = normalizeOfferSdp(escaped)
    expect(out).toContain('a=rtpmap:111 opus/48000/2\r\n')
    expect(out.startsWith('v=0\r\n')).toBe(true)
  })
})
