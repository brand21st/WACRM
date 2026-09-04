import { describe, expect, it } from 'vitest'

import { aiChatReplyJob } from './jobs'

const BASE = {
  accountId: 'acc-1',
  conversationId: 'conv-1',
  contactId: 'c-1',
  configOwnerUserId: 'u-1',
  messageId: 'msg-1',
  inboundMetaMessageId: 'wamid.1',
  isFirstInbound: false,
}

describe('aiChatReplyJob', () => {
  it('does not attach media fields on text jobs', () => {
    const job = aiChatReplyJob({
      ...BASE,
      inboundContentType: 'text',
      inboundMediaUrl: 'https://cdn.example/a.jpg',
      inboundAccessToken: 'token',
    })
    expect(job.inboundContentType).toBe('text')
    expect(job.inboundAccessToken).toBeUndefined()
    expect(job.inboundMediaUrl).toBeUndefined()
  })

  it('keeps media fields on image jobs', () => {
    const job = aiChatReplyJob({
      ...BASE,
      inboundContentType: 'image',
      inboundMediaUrl: 'https://cdn.example/a.jpg',
      inboundMediaId: 'img-1',
      inboundAccessToken: 'token',
    })
    expect(job).toMatchObject({
      inboundContentType: 'image',
      inboundMediaUrl: 'https://cdn.example/a.jpg',
      inboundMediaId: 'img-1',
      inboundAccessToken: 'token',
    })
  })
})
