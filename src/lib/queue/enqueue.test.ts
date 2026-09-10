import { beforeEach, describe, expect, it, vi } from 'vitest'

const add = vi.fn()

vi.mock('bullmq', () => ({
  Queue: class {
    add = add
  },
}))

vi.mock('./redis', () => ({
  getBullmqConnection: vi.fn(),
}))

import { getBullmqConnection } from './redis'
import {
  enqueueAiChatReply,
  enqueueAiVoiceInbound,
  enqueueCallRecording,
  enqueueCatalogEmbed,
  enqueueCatalogMetaSync,
  enqueueAiConversationFollowUp,
  enqueueAiConversationAnalyze,
  enqueueAiSalesPatternDiscover,
  enqueueAiSalesPatternEffectiveness,
  enqueueKnowledgeScrape,
  isDuplicateJobError,
  resetQueuesForTests,
} from './enqueue'

const mockGetBullmqConnection = vi.mocked(getBullmqConnection)

const CHAT_JOB = {
  accountId: 'acc-1',
  conversationId: 'conv-1',
  contactId: 'c-1',
  configOwnerUserId: 'u-1',
  messageId: 'msg-1',
  inboundContentType: 'text' as const,
}

beforeEach(() => {
  resetQueuesForTests()
  vi.clearAllMocks()
  add.mockResolvedValue({ id: 'job-1' })
})

describe('isDuplicateJobError', () => {
  it('detects BullMQ custom jobId collisions', () => {
    expect(isDuplicateJobError(new Error('Job msg-1 already exists'))).toBe(true)
    expect(isDuplicateJobError(new Error('redis down'))).toBe(false)
  })
})

describe('enqueue helpers', () => {
  it('returns false when Redis is not configured', async () => {
    mockGetBullmqConnection.mockReturnValue(null)
    await expect(enqueueAiChatReply(CHAT_JOB)).resolves.toBe(false)
    await expect(
      enqueueAiConversationAnalyze({
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'c-1',
        triggeringMessageId: 'msg-1',
        idempotencyKey: 'acc-1:conv-1:msg-1',
      }),
    ).resolves.toBe(false)
    await expect(
      enqueueAiSalesPatternDiscover({
        accountId: 'acc-1',
        idempotencyKey: 'acc-1:patterns',
      }),
    ).resolves.toBe(false)
    expect(add).not.toHaveBeenCalled()
  })

  it('adds a chat job keyed by messageId', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueAiChatReply({ ...CHAT_JOB, isFirstInbound: true }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'ai-chat-reply',
      expect.objectContaining({ messageId: 'msg-1', isFirstInbound: true }),
      expect.objectContaining({ jobId: 'msg-1', attempts: 5 }),
    )
  })

  it('adds a voice job keyed by messageId', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueAiVoiceInbound({
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'c-1',
        messageId: 'msg-1',
        userId: 'u-1',
        metaMessageId: 'wamid.1',
        mediaId: 'media-1',
      }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'ai-voice-inbound',
      expect.objectContaining({ mediaId: 'media-1' }),
      expect.objectContaining({ jobId: 'msg-1' }),
    )
  })

  it('adds a call-recording job keyed by callId', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueCallRecording({ accountId: 'acc-1', callId: 'call-1' }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'call-recording',
      { accountId: 'acc-1', callId: 'call-1' },
      expect.objectContaining({ jobId: 'call-1' }),
    )
  })

  it('treats a duplicate jobId as already queued (Meta replay)', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    add.mockRejectedValueOnce(new Error('Job msg-1 already exists'))
    await expect(enqueueAiChatReply(CHAT_JOB)).resolves.toBe(true)
  })

  it('treats a silent duplicate (add returns null) as already queued', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    add.mockResolvedValueOnce(null)
    await expect(enqueueAiChatReply(CHAT_JOB)).resolves.toBe(true)
  })

  it('adds a catalog-embed job keyed by productId', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueCatalogEmbed({ accountId: 'acc-1', productId: 'prod-1' }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'catalog-embed',
      { accountId: 'acc-1', productId: 'prod-1' },
      expect.objectContaining({ jobId: 'prod-1', attempts: 5 }),
    )
  })

  it('adds a catalog-meta-sync job keyed by outboxId', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueCatalogMetaSync({ accountId: 'acc-1', outboxId: 'outbox-1' }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'catalog-meta-sync',
      { accountId: 'acc-1', outboxId: 'outbox-1' },
      expect.objectContaining({ jobId: 'outbox-1', attempts: 5 }),
    )
  })

  it('adds a knowledge-scrape job keyed by jobId', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueKnowledgeScrape({ jobId: 'scrape-1', accountId: 'acc-1' }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'knowledge-scrape',
      { jobId: 'scrape-1', accountId: 'acc-1' },
      expect.objectContaining({ jobId: 'scrape-1' }),
    )
  })

  it('adds a conversation-analyze job keyed by the idempotency key', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueAiConversationAnalyze({
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'c-1',
        triggeringMessageId: 'msg-1',
        idempotencyKey: 'acc-1:conv-1:msg-1',
      }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'ai-conversation-analyze',
      expect.objectContaining({ accountId: 'acc-1', triggeringMessageId: 'msg-1' }),
      expect.objectContaining({ jobId: 'acc-1:conv-1:msg-1', attempts: 5 }),
    )
  })

  it('adds a sales-pattern-discover job keyed by accountId:patterns', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueAiSalesPatternDiscover({
        accountId: 'acc-1',
        idempotencyKey: 'acc-1:patterns',
      }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'ai-sales-pattern-discover',
      expect.objectContaining({ accountId: 'acc-1' }),
      expect.objectContaining({ jobId: 'acc-1:patterns', attempts: 5 }),
    )
  })

  it('adds a sales-pattern-effectiveness job keyed by accountId:effectiveness', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueAiSalesPatternEffectiveness({
        accountId: 'acc-1',
        idempotencyKey: 'acc-1:effectiveness',
      }),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'ai-sales-pattern-effectiveness',
      expect.objectContaining({ accountId: 'acc-1' }),
      expect.objectContaining({ jobId: 'acc-1:effectiveness', attempts: 5 }),
    )
  })

  it('adds a delayed conversation follow-up job', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    await expect(
      enqueueAiConversationFollowUp(
        {
          accountId: 'acc-1',
          conversationId: 'conv-1',
          followUpId: 'fu-1',
          triggeringMessageId: 'msg-bot',
        },
        15 * 60_000,
      ),
    ).resolves.toBe(true)
    expect(add).toHaveBeenCalledWith(
      'ai-conversation-follow-up',
      expect.objectContaining({ followUpId: 'fu-1' }),
      expect.objectContaining({ jobId: 'fu-1', delay: 15 * 60_000 }),
    )
  })

  it('returns false when Queue.add throws a real failure', async () => {
    mockGetBullmqConnection.mockReturnValue({ host: '127.0.0.1', port: 6379 } as never)
    add.mockRejectedValueOnce(new Error('redis down'))
    await expect(
      enqueueCallRecording({ accountId: 'acc-1', callId: 'call-1' }),
    ).resolves.toBe(false)
  })
})
