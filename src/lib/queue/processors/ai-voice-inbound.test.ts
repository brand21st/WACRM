import { beforeEach, describe, expect, it, vi } from 'vitest'

const executeVoiceInboundWork = vi.fn()
const supabaseAdmin = vi.fn()

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => supabaseAdmin(),
}))

vi.mock('@/lib/ai/voice-inbound-jobs', () => ({
  executeVoiceInboundWork: (...args: unknown[]) =>
    executeVoiceInboundWork(...args),
}))

import { processAiVoiceInbound } from './ai-voice-inbound'

describe('processAiVoiceInbound', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseAdmin.mockReturnValue({ tagged: 'db' })
    executeVoiceInboundWork.mockResolvedValue(undefined)
  })

  it('maps the BullMQ payload onto the shared STT runner', async () => {
    await processAiVoiceInbound({
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'c-1',
      messageId: 'msg-1',
      userId: 'u-1',
      metaMessageId: 'wamid.1',
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
    })
    expect(executeVoiceInboundWork).toHaveBeenCalledWith(
      { tagged: 'db' },
      {
        account_id: 'acc-1',
        conversation_id: 'conv-1',
        contact_id: 'c-1',
        message_id: 'msg-1',
        user_id: 'u-1',
        meta_message_id: 'wamid.1',
        media_id: 'media-1',
        mime_type: 'audio/ogg',
      },
    )
  })

  it('propagates STT failures so BullMQ retries', async () => {
    executeVoiceInboundWork.mockRejectedValueOnce(new Error('transcription empty'))
    await expect(
      processAiVoiceInbound({
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'c-1',
        messageId: 'msg-1',
        userId: 'u-1',
        metaMessageId: 'wamid.1',
        mediaId: 'media-1',
      }),
    ).rejects.toThrow('transcription empty')
  })
})
