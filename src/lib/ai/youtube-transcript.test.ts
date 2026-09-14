import { describe, expect, it } from 'vitest'

import {
  isYoutubeListUrl,
  parseYoutubeVideoId,
} from './scrape-url'
import {
  buildYoutubeDocumentBody,
  extractJsonAssignment,
  pickCaptionTrack,
  timedtextToPlain,
} from './youtube-transcript'

describe('parseYoutubeVideoId', () => {
  it('parses watch, shorts, embed, and youtu.be', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
    expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(parseYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
    expect(parseYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    )
  })

  it('rejects playlists and channels without a video id', () => {
    expect(parseYoutubeVideoId('https://www.youtube.com/playlist?list=PLxx')).toBeNull()
    expect(parseYoutubeVideoId('https://www.youtube.com/@acme')).toBeNull()
    expect(isYoutubeListUrl('https://www.youtube.com/playlist?list=PLxx')).toBe(true)
    expect(isYoutubeListUrl('https://www.youtube.com/channel/UCxxxx')).toBe(true)
  })
})

describe('timedtextToPlain', () => {
  it('reads json3 events', () => {
    expect(
      timedtextToPlain(
        JSON.stringify({
          events: [
            { segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
            { segs: [{ utf8: 'Welcome to Acme.' }] },
          ],
        }),
      ),
    ).toBe('Hello world\nWelcome to Acme.')
  })

  it('reads XML text nodes', () => {
    expect(
      timedtextToPlain(
        '<transcript><text start="0">Hello &amp; welcome</text><text>We make bags</text></transcript>',
      ),
    ).toBe('Hello & welcome\nWe make bags')
  })
})

describe('caption helpers', () => {
  it('prefers a matching language then a manual track', () => {
    const tracks = [
      { baseUrl: 'https://www.youtube.com/api/timedtext?asr=1', languageCode: 'es', kind: 'asr' },
      { baseUrl: 'https://www.youtube.com/api/timedtext?en=1', languageCode: 'en' },
    ]
    expect(pickCaptionTrack(tracks, 'en')?.languageCode).toBe('en')
    expect(pickCaptionTrack(tracks, 'fr')?.languageCode).toBe('en')
  })

  it('builds a titled transcript body', () => {
    const body = buildYoutubeDocumentBody({
      title: 'About Acme',
      description: 'Store intro',
      transcript: 'We make handmade bags in Kerala.',
    })
    expect(body).toContain('About Acme')
    expect(body).toContain('We make handmade bags')
  })

  it('extracts ytInitialPlayerResponse JSON', () => {
    const html =
      '<script>var ytInitialPlayerResponse = {"videoDetails":{"title":"Hi"}};</script>'
    expect(extractJsonAssignment(html, 'ytInitialPlayerResponse')).toEqual({
      videoDetails: { title: 'Hi' },
    })
  })
})
