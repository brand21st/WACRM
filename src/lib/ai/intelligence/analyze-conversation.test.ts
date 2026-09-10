import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context'
import { MissingAccountIdError } from './contracts'
import { analyzeConversation } from './analyze-conversation'
import type { AnalyzerMessage } from './extract-deterministic'

const db = {} as SupabaseClient

const JOB = {
  accountId: 'acct-a',
  conversationId: 'conv-a',
  contactId: 'contact-a',
  triggeringMessageId: 'msg-1',
  idempotencyKey: 'acct-a:conv-a:msg-1',
}

function message(partial: Partial<AnalyzerMessage> & { id: string }): AnalyzerMessage {
  return {
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'hello',
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function silentDeps(overrides: Record<string, unknown> = {}) {
  const insertEvents = vi.fn().mockResolvedValue(0)
  const upsertCursor = vi.fn().mockResolvedValue(undefined)
  const extractLlm = vi.fn().mockResolvedValue([])
  return {
    insertEvents,
    upsertCursor,
    extractLlm,
    loadCursor: vi.fn().mockResolvedValue(null),
    loadCommerceOrders: vi.fn().mockResolvedValue([]),
    loadCatalogEvents: vi.fn().mockResolvedValue([]),
    loadAbandonedCheckouts: vi.fn().mockResolvedValue([]),
    loadContactPaid: vi.fn().mockResolvedValue(null),
    loadExistingEvents: vi.fn().mockResolvedValue([]),
    loadShopping: vi.fn().mockResolvedValue(emptyShoppingContext()),
    loadAiConfig: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

describe('analyzeConversation isolation', () => {
  it('throws before any DB write when accountId is missing', async () => {
    const deps = silentDeps({
      loadConversation: vi.fn(),
    })
    await expect(
      analyzeConversation(db, { ...JOB, accountId: '' }, deps),
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    expect(deps.loadConversation).not.toHaveBeenCalled()
    expect(deps.insertEvents).not.toHaveBeenCalled()
  })

  it('does not write events when the conversation belongs to another account', async () => {
    const deps = silentDeps({
      loadConversation: vi.fn().mockResolvedValue(null),
      loadMessages: vi.fn(),
    })
    const result = await analyzeConversation(db, JOB, deps)
    expect(result).toEqual({
      wrote: 0,
      skipped: true,
      reason: 'conversation_not_found',
    })
    expect(deps.loadMessages).not.toHaveBeenCalled()
    expect(deps.insertEvents).not.toHaveBeenCalled()
    expect(deps.upsertCursor).not.toHaveBeenCalled()
  })

  it('loads existing events only for the job account + conversation', async () => {
    const loadExistingEvents = vi.fn().mockResolvedValue([])
    const deps = silentDeps({
      loadConversation: vi.fn().mockResolvedValue({
        id: 'conv-a',
        contact_id: 'contact-a',
        ai_autoreply_disabled: false,
      }),
      loadMessages: vi.fn().mockResolvedValue([
        message({ id: 'msg-1', content_text: 'hi' }),
      ]),
      loadExistingEvents,
    })
    await analyzeConversation(db, JOB, deps)
    expect(loadExistingEvents).toHaveBeenCalledWith(db, 'acct-a', 'conv-a')
  })
})

describe('analyzeConversation outcomes vs signals', () => {
  it('persists a paid order as outcomes and advances the cursor', async () => {
    const insertEvents = vi.fn().mockResolvedValue(2)
    const upsertCursor = vi.fn().mockResolvedValue(undefined)
    const extractLlm = vi.fn()
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents, upsertCursor, extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
        ai_autoreply_disabled: false,
      }),
      loadMessages: async () => [message({ id: 'msg-1', content_text: 'thanks' })],
      loadCommerceOrders: async () => [
        { id: 'ord-1', status: 'processing', line_items: [] },
      ],
    })
    expect(insertEvents).toHaveBeenCalled()
    const rows = insertEvents.mock.calls[0][1] as Array<{ event_type: string; kind: string }>
    expect(rows.map((r) => r.event_type).sort()).toEqual([
      'ORDER_CREATED',
      'PAYMENT_COMPLETED',
    ])
    expect(rows.every((r) => r.kind === 'outcome')).toBe(true)
    expect(extractLlm).not.toHaveBeenCalled()
    expect(upsertCursor).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acct-a',
        conversationId: 'conv-a',
        lastSourceMessageId: 'msg-1',
      }),
    )
  })

  it('does not create ORDER_CREATED from looks good', async () => {
    const insertEvents = vi.fn().mockResolvedValue(0)
    const extractLlm = vi.fn()
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents, extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'looks good' }),
      ],
    })
    const rows = (insertEvents.mock.calls[0]?.[1] ?? []) as Array<{
      event_type: string
    }>
    expect(rows.some((r) => r.event_type === 'ORDER_CREATED')).toBe(false)
    expect(extractLlm).not.toHaveBeenCalled()
  })

  it('does not call the LLM on an empty greeting', async () => {
    const extractLlm = vi.fn()
    await analyzeConversation(db, JOB, {
      ...silentDeps({ extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [message({ id: 'msg-1', content_text: 'ok' })],
    })
    expect(extractLlm).not.toHaveBeenCalled()
  })

  it('keeps deterministic rows when LLM JSON is invalid', async () => {
    const insertEvents = vi.fn().mockResolvedValue(1)
    const extractLlm = vi.fn().mockResolvedValue([])
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents, extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'how much does this red saree cost?' }),
      ],
      loadAiConfig: async () => ({ apiKey: 'sk' }),
    })
    expect(extractLlm).toHaveBeenCalled()
    const rows = insertEvents.mock.calls[0][1] as Array<{ event_type: string }>
    expect(rows.some((r) => r.event_type === 'ORDER_CREATED')).toBe(false)
  })

  it('does not duplicate events when the same message is analyzed twice', async () => {
    const existing = [
      {
        event_type: 'PURCHASE_INTENT',
        source_message_id: 'msg-1',
        source_table: 'messages',
        source_id: 'msg-1',
      },
      {
        event_type: 'READY_TO_BUY',
        source_message_id: 'msg-1',
        source_table: 'messages',
        source_id: 'msg-1',
      },
    ]
    const insertEvents = vi.fn().mockResolvedValue(0)
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: "I'll take this" }),
      ],
      loadExistingEvents: async () => existing,
    })
    const rows = (insertEvents.mock.calls[0]?.[1] ?? []) as unknown[]
    expect(rows).toHaveLength(0)
  })
})
