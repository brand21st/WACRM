import { beforeEach, describe, expect, it, vi } from 'vitest'

const dispatchInboundToAiReply = vi.fn()
const loadAiConfig = vi.fn()
const describeInboundImage = vi.fn()
const loadShopifyConfig = vi.fn()
const messageUpdates: Array<{ patch: Record<string, unknown>; id: string }> = []
const conversationUpdates: Array<{ patch: Record<string, unknown>; id: string }> =
  []

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'msg-1', content_text: caption },
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            if (table === 'messages') messageUpdates.push({ patch, id })
            if (table === 'conversations') conversationUpdates.push({ patch, id })
            return { error: null }
          },
        }),
      }
    },
  }),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: (...args: unknown[]) =>
    dispatchInboundToAiReply(...args),
}))

vi.mock('@/lib/ai/config', () => ({
  loadAiConfig: (...args: unknown[]) => loadAiConfig(...args),
}))

vi.mock('@/lib/ai/describe-inbound-image', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/ai/describe-inbound-image')>()
  return {
    ...actual,
    describeInboundImage: (...args: unknown[]) => describeInboundImage(...args),
  }
})

vi.mock('@/lib/shopify/config', () => ({
  loadShopifyConfig: (...args: unknown[]) => loadShopifyConfig(...args),
}))

import { IMAGE_PLACEHOLDER, PRODUCT_PHOTO_PLACEHOLDER } from '@/lib/ai/describe-inbound-image'
import { processAiChatReply } from './ai-chat-reply'

let caption: string | null = 'hi'

beforeEach(() => {
  vi.clearAllMocks()
  caption = 'hi'
  messageUpdates.length = 0
  conversationUpdates.length = 0
  dispatchInboundToAiReply.mockResolvedValue(undefined)
  loadAiConfig.mockResolvedValue(null)
  describeInboundImage.mockResolvedValue(null)
  loadShopifyConfig.mockResolvedValue(null)
})

describe('processAiChatReply', () => {
  it('dispatches a text reply without vision', async () => {
    await processAiChatReply({
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'c-1',
      configOwnerUserId: 'u-1',
      messageId: 'msg-1',
      inboundContentType: 'text',
      isFirstInbound: true,
    })
    expect(describeInboundImage).not.toHaveBeenCalled()
    expect(dispatchInboundToAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundContentType: 'text',
        isFirstInbound: true,
      }),
    )
  })

  it('describes an inbound image, persists it, then auto-replies', async () => {
    loadAiConfig.mockResolvedValue({
      provider: 'openai',
      apiKey: 'sk-test',
    })
    describeInboundImage.mockResolvedValue('a red shoe')
    await processAiChatReply({
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'c-1',
      configOwnerUserId: 'u-1',
      messageId: 'msg-1',
      inboundContentType: 'image',
      inboundMediaUrl: 'https://cdn.test/img.jpg',
    })
    expect(describeInboundImage).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'support',
        mediaUrl: 'https://cdn.test/img.jpg',
        caption: 'hi',
      }),
    )
    expect(messageUpdates[0]).toEqual({
      patch: { content_text: 'a red shoe' },
      id: 'msg-1',
    })
    expect(conversationUpdates[0]).toEqual({
      patch: { last_message_text: 'a red shoe' },
      id: 'conv-1',
    })
    expect(dispatchInboundToAiReply).toHaveBeenCalledWith(
      expect.objectContaining({ inboundContentType: 'image' }),
    )
  })

  it('uses shopping vision when Shopify is connected', async () => {
    loadAiConfig.mockResolvedValue({ provider: 'openai', apiKey: 'sk-test' })
    loadShopifyConfig.mockResolvedValue({ shop: 'store.myshopify.com' })
    caption = null
    describeInboundImage.mockResolvedValue(null)
    await processAiChatReply({
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'c-1',
      configOwnerUserId: 'u-1',
      messageId: 'msg-1',
      inboundContentType: 'image',
    })
    expect(describeInboundImage).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'shopping' }),
    )
    expect(messageUpdates[0]?.patch).toEqual({
      content_text: PRODUCT_PHOTO_PLACEHOLDER,
    })
  })

  it('falls back to the support image placeholder when vision is empty', async () => {
    loadAiConfig.mockResolvedValue({ provider: 'openai', apiKey: 'sk-test' })
    caption = null
    describeInboundImage.mockResolvedValue(null)
    await processAiChatReply({
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'c-1',
      configOwnerUserId: 'u-1',
      messageId: 'msg-1',
      inboundContentType: 'image',
    })
    expect(messageUpdates[0]?.patch).toEqual({
      content_text: IMAGE_PLACEHOLDER,
    })
  })
})
