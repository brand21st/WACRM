import { describe, expect, it } from 'vitest'
import {
  isMediaQuickReplyKind,
  isQuickReplyKind,
  parseQuickReplyContent,
} from './quick-replies'
import { MEDIA_CAPTION_MAX } from './storage/upload-media'

const buttonsPayload = {
  kind: 'buttons',
  body: 'Pick one',
  buttons: [{ id: 'yes', title: 'Yes' }],
}

describe('isQuickReplyKind', () => {
  it('accepts text, interactive, and media kinds', () => {
    expect(isQuickReplyKind('text')).toBe(true)
    expect(isQuickReplyKind('interactive')).toBe(true)
    expect(isQuickReplyKind('image')).toBe(true)
    expect(isQuickReplyKind('video')).toBe(true)
    expect(isQuickReplyKind('document')).toBe(true)
  })

  it('rejects unknown values', () => {
    expect(isQuickReplyKind('audio')).toBe(false)
    expect(isQuickReplyKind('')).toBe(false)
    expect(isQuickReplyKind(null)).toBe(false)
  })
})

describe('isMediaQuickReplyKind', () => {
  it('is true only for image, video, and document', () => {
    expect(isMediaQuickReplyKind('image')).toBe(true)
    expect(isMediaQuickReplyKind('video')).toBe(true)
    expect(isMediaQuickReplyKind('document')).toBe(true)
    expect(isMediaQuickReplyKind('text')).toBe(false)
    expect(isMediaQuickReplyKind('interactive')).toBe(false)
  })
})

describe('parseQuickReplyContent', () => {
  it('requires content_text for text kinds', () => {
    const empty = parseQuickReplyContent({}, 'text')
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toMatch(/content_text/)

    const ok = parseQuickReplyContent({ content_text: '  Hello  ' }, 'text')
    expect(ok).toEqual({
      ok: true,
      fields: {
        kind: 'text',
        content_text: '  Hello  ',
        interactive_payload: null,
        media_url: null,
        media_path: null,
        media_filename: null,
      },
    })
  })

  it('requires a valid interactive payload', () => {
    const bad = parseQuickReplyContent({ interactive_payload: {} }, 'interactive')
    expect(bad.ok).toBe(false)

    const ok = parseQuickReplyContent(
      { interactive_payload: buttonsPayload },
      'interactive',
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.fields.kind).toBe('interactive')
      expect(ok.fields.interactive_payload).toEqual(buttonsPayload)
      expect(ok.fields.media_url).toBeNull()
    }
  })

  it('requires media_url and media_path for media kinds', () => {
    const missing = parseQuickReplyContent({ media_url: 'https://x' }, 'image')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toMatch(/media_url and media_path/)
  })

  it('stores caption in content_text and clears interactive payload', () => {
    const ok = parseQuickReplyContent(
      {
        media_url: ' https://cdn.example/a.jpg ',
        media_path: ' account-1/a.jpg ',
        media_filename: ' chart.jpg ',
        content_text: '  Size chart  ',
      },
      'image',
    )
    expect(ok).toEqual({
      ok: true,
      fields: {
        kind: 'image',
        content_text: 'Size chart',
        interactive_payload: null,
        media_url: 'https://cdn.example/a.jpg',
        media_path: 'account-1/a.jpg',
        media_filename: 'chart.jpg',
      },
    })
  })

  it('allows a blank caption on documents', () => {
    const ok = parseQuickReplyContent(
      {
        media_url: 'https://cdn.example/a.pdf',
        media_path: 'account-1/a.pdf',
        media_filename: 'policy.pdf',
      },
      'document',
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.fields.content_text).toBeNull()
      expect(ok.fields.kind).toBe('document')
    }
  })

  it('rejects captions over Meta’s 1024-char cap', () => {
    const ok = parseQuickReplyContent(
      {
        media_url: 'https://cdn.example/a.jpg',
        media_path: 'account-1/a.jpg',
        content_text: 'x'.repeat(MEDIA_CAPTION_MAX + 1),
      },
      'video',
    )
    expect(ok.ok).toBe(false)
    if (!ok.ok) expect(ok.error).toMatch(/1024/)
  })
})
