import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  engineSendText: vi.fn(),
}))

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
}))

import {
  PHOTO_WAIT_ACK,
  isPhotoWaitAck,
  photoWaitAckText,
  sendPhotoWaitAck,
} from './photo-wait-ack'

describe('photoWaitAckText', () => {
  it('follows Malayalam and Hindi script, otherwise English', () => {
    expect(photoWaitAckText('എനിക്ക് ഈ സാരി വേണം')).toBe(PHOTO_WAIT_ACK.ml)
    expect(photoWaitAckText('यह साड़ी दिखाओ')).toBe(PHOTO_WAIT_ACK.hi)
    expect(photoWaitAckText('what is this?')).toBe(PHOTO_WAIT_ACK.en)
    expect(photoWaitAckText('')).toBe(PHOTO_WAIT_ACK.en)
  })
})

describe('isPhotoWaitAck', () => {
  it('recognizes the canned wait lines only', () => {
    expect(isPhotoWaitAck(PHOTO_WAIT_ACK.ml)).toBe(true)
    expect(isPhotoWaitAck(PHOTO_WAIT_ACK.en)).toBe(true)
    expect(isPhotoWaitAck('Let me check that photo — one moment.')).toBe(true)
    expect(isPhotoWaitAck('This looks like our Red Bag.')).toBe(false)
  })
})

describe('sendPhotoWaitAck', () => {
  beforeEach(() => {
    h.engineSendText.mockReset()
    h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid.ack' })
  })

  it('sends the wait line as an AI text bubble', async () => {
    await sendPhotoWaitAck({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      languageHint: 'ഫോട്ടോ',
    })
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        text: PHOTO_WAIT_ACK.ml,
        aiGenerated: true,
      }),
    )
  })
})
