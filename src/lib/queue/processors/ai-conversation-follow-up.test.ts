import { beforeEach, describe, expect, it, vi } from 'vitest'

const processConversationFollowUp = vi.fn()

vi.mock('@/lib/ai/follow-up', () => ({
  processConversationFollowUp: (...args: unknown[]) =>
    processConversationFollowUp(...args),
}))

import { processAiConversationFollowUp } from './ai-conversation-follow-up'

describe('processAiConversationFollowUp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    processConversationFollowUp.mockResolvedValue(undefined)
  })

  it('forwards the delayed job payload to the follow-up processor', async () => {
    const job = {
      accountId: 'acc-1',
      conversationId: 'conv-1',
      followUpId: 'fu-1',
      triggeringMessageId: 'msg-bot',
    }
    await processAiConversationFollowUp(job)
    expect(processConversationFollowUp).toHaveBeenCalledWith(job)
  })
})
