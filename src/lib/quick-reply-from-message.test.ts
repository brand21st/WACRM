import { describe, expect, it } from 'vitest'
import {
  canSaveMessageAsQuickReply,
  quickReplyDraftFromMessage,
} from './quick-reply-from-message'
import type { Message } from '@/types'

const buttonsPayload = {
  kind: 'buttons' as const,
  body: 'Pick one',
  buttons: [{ id: 'yes', title: 'Yes' }],
}

function msg(partial: Partial<Message> & Pick<Message, 'content_type'>): Message {
  return {
    id: 'm1',
    conversation_id: 'c1',
    sender_type: 'customer',
    status: 'delivered',
    created_at: '2026-09-09T12:00:00.000Z',
    ...partial,
  }
}

describe('canSaveMessageAsQuickReply', () => {
  it('is false for audio, location, call, and order', () => {
    expect(canSaveMessageAsQuickReply(msg({ content_type: 'audio' }))).toBe(false)
    expect(canSaveMessageAsQuickReply(msg({ content_type: 'location' }))).toBe(
      false,
    )
    expect(canSaveMessageAsQuickReply(msg({ content_type: 'call' }))).toBe(false)
    expect(canSaveMessageAsQuickReply(msg({ content_type: 'order' }))).toBe(false)
  })

  it('is false for empty text', () => {
    expect(canSaveMessageAsQuickReply(msg({ content_type: 'text' }))).toBe(false)
  })
})

describe('quickReplyDraftFromMessage', () => {
  it('maps a text bubble to a text quick reply', () => {
    const draft = quickReplyDraftFromMessage(
      msg({ content_type: 'text', content_text: 'Hello there\nsecond line' }),
    )
    expect(draft).toEqual({
      ok: true,
      kind: 'text',
      content_text: 'Hello there\nsecond line',
      defaultTitle: 'Hello there',
    })
  })

  it('maps a template to text, falling back to template_name', () => {
    const withBody = quickReplyDraftFromMessage(
      msg({
        content_type: 'template',
        content_text: 'Your refund is on the way',
        template_name: 'shopify_refund',
      }),
    )
    expect(withBody.ok).toBe(true)
    if (withBody.ok && withBody.kind === 'text') {
      expect(withBody.content_text).toBe('Your refund is on the way')
    }

    const nameOnly = quickReplyDraftFromMessage(
      msg({ content_type: 'template', template_name: 'shopify_refund' }),
    )
    expect(nameOnly).toMatchObject({
      ok: true,
      kind: 'text',
      content_text: 'shopify_refund',
      defaultTitle: 'shopify_refund',
    })
  })

  it('maps an outbound buttons payload to an interactive quick reply', () => {
    const draft = quickReplyDraftFromMessage(
      msg({
        content_type: 'interactive',
        sender_type: 'agent',
        interactive_payload: buttonsPayload,
        content_text: 'Pick one',
      }),
    )
    expect(draft.ok).toBe(true)
    if (draft.ok && draft.kind === 'interactive') {
      expect(draft.interactive_payload).toEqual(buttonsPayload)
      expect(draft.defaultTitle).toBe('Pick one')
    }
  })

  it('maps an inbound button tap to text when there is no sendable payload', () => {
    const draft = quickReplyDraftFromMessage(
      msg({
        content_type: 'interactive',
        sender_type: 'customer',
        interactive_reply_id: 'yes',
        content_text: 'Yes',
      }),
    )
    expect(draft).toEqual({
      ok: true,
      kind: 'text',
      content_text: 'Yes',
      defaultTitle: 'Yes',
    })
  })

  it('rejects inbound interactive taps with no text', () => {
    const draft = quickReplyDraftFromMessage(
      msg({
        content_type: 'interactive',
        sender_type: 'customer',
        interactive_reply_id: 'yes',
      }),
    )
    expect(draft).toEqual({ ok: false })
  })

  it('rejects inbound_order payloads even when stored as interactive', () => {
    const draft = quickReplyDraftFromMessage(
      msg({
        content_type: 'interactive',
        interactive_payload: { kind: 'inbound_order', items: [] },
      }),
    )
    expect(draft).toEqual({ ok: false })
  })

  it('maps image/video with caption and a document filename', () => {
    const image = quickReplyDraftFromMessage(
      msg({
        content_type: 'image',
        media_url:
          'https://cdn.example/chat-media/account-a/1770000000000-size-chart.png',
        content_text: 'Our size chart',
      }),
    )
    expect(image.ok).toBe(true)
    if (image.ok && image.kind === 'image') {
      expect(image.media_url).toContain('size-chart.png')
      expect(image.content_text).toBe('Our size chart')
      expect(image.media_filename).toBe('size-chart.png')
      expect(image.defaultTitle).toBe('size-chart')
      expect(image.sourceMessageId).toBe('m1')
    }

    const video = quickReplyDraftFromMessage(
      msg({
        content_type: 'video',
        media_url:
          'https://cdn.example/chat-media/account-a/1770000000000-clip.mp4',
      }),
    )
    expect(video.ok).toBe(true)
    if (video.ok) expect(video.kind).toBe('video')

    const doc = quickReplyDraftFromMessage(
      msg({
        content_type: 'document',
        media_url:
          'https://cdn.example/chat-media/account-a/1770000000000-policy.pdf',
        content_text: 'policy.pdf',
      }),
    )
    expect(doc.ok).toBe(true)
    if (doc.ok && doc.kind === 'document') {
      expect(doc.content_text).toBeNull()
      expect(doc.media_filename).toBe('policy.pdf')
      expect(doc.defaultTitle).toBe('policy')
    }
  })

  it('rejects media with no URL', () => {
    expect(
      quickReplyDraftFromMessage(msg({ content_type: 'image' })),
    ).toEqual({ ok: false })
  })

  it('clips a long default title', () => {
    const draft = quickReplyDraftFromMessage(
      msg({ content_type: 'text', content_text: 'x'.repeat(80) }),
    )
    expect(draft.ok).toBe(true)
    if (draft.ok) expect(draft.defaultTitle.length).toBe(60)
  })
})
