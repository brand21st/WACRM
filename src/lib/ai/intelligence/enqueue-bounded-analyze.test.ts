import { describe, expect, it, vi } from 'vitest'
import { MissingAccountIdError } from './contracts'
import {
  clampAnalyzeBatchSize,
  clampAnalyzeWindowDays,
  enqueueBoundedConversationAnalyze,
  previewBoundedConversationAnalyze,
  reconcilePendingConversationAnalysis,
} from './enqueue-bounded-analyze'

describe('bounded analyze limits', () => {
  it('clamps window and batch to server-controlled bounds', () => {
    expect(clampAnalyzeWindowDays(0)).toBe(1)
    expect(clampAnalyzeWindowDays(400)).toBe(90)
    expect(clampAnalyzeBatchSize(1000)).toBe(100)
    expect(clampAnalyzeBatchSize(-3)).toBe(1)
  })
})

describe('previewBoundedConversationAnalyze', () => {
  it('throws before querying when accountId is missing', async () => {
    const rpc = vi.fn()
    await expect(
      previewBoundedConversationAnalyze({ rpc } as never, '')
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('scopes the preview RPC to the session account and omits content', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          window_days: 7,
          max_conversations: 10,
          eligible_conversations: 83,
          selected_conversations: 10,
          eligible_turns: 120,
          minimum_analyzer_pages: 8,
          first_eligible_at: '2026-09-04T00:00:00.000Z',
          last_eligible_at: '2026-09-11T00:00:00.000Z',
          commerce_order_count: 28,
          completed_order_count: 1,
          canceled_order_count: 13,
        },
      ],
      error: null,
    })
    const from = vi.fn(() => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: { background_learning_mode: 'deterministic' },
          error: null,
        }),
      }
      return query
    })
    const preview = await previewBoundedConversationAnalyze(
      { rpc, from } as never,
      ' acct-a ',
      { windowDays: 7, maxConversations: 10 }
    )
    expect(rpc).toHaveBeenCalledWith('preview_conversation_analysis_backfill', {
      p_account_id: 'acct-a',
      p_window_days: 7,
      p_limit: 10,
    })
    expect(preview.estimated_llm_calls).toBe(0)
    expect(preview.estimated_cost_usd).toBe(0)
    expect(JSON.stringify(preview)).not.toMatch(
      /content_text|phone|email|transcript/i
    )
  })
})

describe('enqueueBoundedConversationAnalyze', () => {
  it('throws before listing when accountId is missing', async () => {
    const listTargets = vi.fn()
    await expect(
      enqueueBoundedConversationAnalyze({} as never, '', { listTargets }),
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    expect(listTargets).not.toHaveBeenCalled()
  })

  it('enqueues only the session account with staggered delays', async () => {
    const enqueue = vi.fn().mockResolvedValue(true)
    const result = await enqueueBoundedConversationAnalyze({} as never, 'acct-a', {
      listTargets: async (_db, accountId) => {
        expect(accountId).toBe('acct-a')
        return [
          {
            conversationId: 'c1',
            contactId: 'p1',
            triggeringMessageId: 'm1',
          },
          {
            conversationId: 'c2',
            contactId: 'p2',
            triggeringMessageId: 'm2',
          },
        ]
      },
      enqueue,
      staggerMs: 250,
    })
    expect(result).toEqual({
      considered: 2,
      queued: 2,
      skipped: 0,
      queue_unavailable: false,
      window_days: 7,
      max_conversations: 10,
    })
    expect(enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        accountId: 'acct-a',
        conversationId: 'c1',
        idempotencyKey: 'acct-a:c1:message:m1',
        trigger: { type: 'message', messageId: 'm1' },
      }),
      0,
    )
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        accountId: 'acct-a',
        conversationId: 'c2',
      }),
      250,
    )
  })

  it('reports queue unavailable when enqueue returns false', async () => {
    const result = await enqueueBoundedConversationAnalyze({} as never, 'acct-a', {
      listTargets: async () => [
        {
          conversationId: 'c1',
          contactId: 'p1',
          triggeringMessageId: 'm1',
        },
      ],
      enqueue: async () => false,
    })
    expect(result.queued).toBe(0)
    expect(result.queue_unavailable).toBe(true)
  })
})

describe('reconcilePendingConversationAnalysis', () => {
  it('requeues oldest durable message and commerce triggers with unique runs', async () => {
    const enqueue = vi.fn().mockResolvedValue(true)
    const db = {
      rpc: vi.fn().mockResolvedValue({
        data: [
          {
            account_id: 'acct-a',
            conversation_id: 'c1',
            contact_id: null,
            triggering_message_id: 'm1',
            pending_trigger: { type: 'message', messageId: 'm1' },
          },
          {
            account_id: 'acct-b',
            conversation_id: 'c2',
            contact_id: 'p2',
            triggering_message_id: null,
            pending_trigger: { type: 'commerce', sourceId: 'payment:o2' },
          },
        ],
        error: null,
      }),
    }
    const result = await reconcilePendingConversationAnalysis(db as never, {
      enqueue,
    })
    expect(result.queued).toBe(2)
    expect(result.window_days).toBe(7)
    expect(enqueue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        contactId: null,
        trigger: { type: 'message', messageId: 'm1' },
        runId: expect.any(String),
      }),
      0,
    )
    expect(enqueue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        trigger: { type: 'commerce', sourceId: 'payment:o2' },
      }),
      250,
    )
  })
})
