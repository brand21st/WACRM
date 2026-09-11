import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context';
import { MissingAccountIdError } from './contracts';
import {
  analyzeConversation,
  markAnalysisFailed,
  setCursorRunning,
  upsertAnalysisCursor,
  type AnalyzeConversationDeps,
} from './analyze-conversation';
import type { AnalyzerMessage } from './extract-deterministic';

const db = {} as SupabaseClient;

const JOB = {
  accountId: 'acct-a',
  conversationId: 'conv-a',
  contactId: 'contact-a',
  trigger: { type: 'message' as const, messageId: 'msg-1' },
  runId: 'run-1',
  idempotencyKey: 'acct-a:conv-a:message:msg-1',
};

function message(
  partial: Partial<AnalyzerMessage> & { id: string }
): AnalyzerMessage {
  return {
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'hello',
    created_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function silentDeps(
  overrides: Partial<AnalyzeConversationDeps> = {}
): AnalyzeConversationDeps & Record<string, unknown> {
  const insertEvents = vi.fn().mockResolvedValue(0);
  const upsertCursor = vi.fn().mockResolvedValue(undefined);
  const extractLlm = vi.fn().mockResolvedValue({
    events: [],
    usage: null,
    status: 'success',
  });
  return {
    insertEvents,
    upsertCursor,
    extractLlm,
    beginCursor: vi.fn().mockResolvedValue(undefined),
    loadControls: vi.fn().mockResolvedValue({
      mode: 'deterministic',
      paused: false,
      dailyConversationLimit: 100,
      dailyTokenLimit: 25000,
    }),
    loadDailyUsage: vi.fn().mockResolvedValue({ conversations: 0, tokens: 0 }),
    deferBudget: vi.fn().mockResolvedValue(undefined),
    logUsage: vi.fn().mockResolvedValue(undefined),
    loadCursor: vi.fn().mockResolvedValue(null),
    loadCommerceOrders: vi.fn().mockResolvedValue([]),
    loadCatalogEvents: vi.fn().mockResolvedValue([]),
    loadAbandonedCheckouts: vi.fn().mockResolvedValue([]),
    loadContactPaid: vi.fn().mockResolvedValue(null),
    loadExistingEvents: vi.fn().mockResolvedValue([]),
    loadOwnedRefs: vi.fn(
      async (
        _db,
        _accountId,
        refs: { productIds: string[]; variantIds: string[] }
      ) => ({
        productIds: new Set<string>(refs.productIds),
        variantIds: new Set<string>(refs.variantIds),
      })
    ),
    loadShopping: vi.fn().mockResolvedValue(emptyShoppingContext()),
    loadAiConfig: vi.fn().mockResolvedValue(null),
    observePatterns: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe('analyzeConversation isolation', () => {
  it('throws before any DB write when accountId is missing', async () => {
    const deps = silentDeps({
      loadConversation: vi.fn(),
    });
    await expect(
      analyzeConversation(db, { ...JOB, accountId: '' }, deps)
    ).rejects.toBeInstanceOf(MissingAccountIdError);
    expect(deps.loadConversation).not.toHaveBeenCalled();
    expect(deps.insertEvents).not.toHaveBeenCalled();
  });

  it('does not write events when the conversation belongs to another account', async () => {
    const deps = silentDeps({
      loadConversation: vi.fn().mockResolvedValue(null),
      loadMessages: vi.fn(),
    });
    const result = await analyzeConversation(db, JOB, deps);
    expect(result).toEqual({
      wrote: 0,
      skipped: true,
      reason: 'conversation_not_found',
    });
    expect(deps.loadMessages).not.toHaveBeenCalled();
    expect(deps.insertEvents).not.toHaveBeenCalled();
    expect(deps.upsertCursor).not.toHaveBeenCalled();
  });

  it('loads existing events only for the job account + conversation', async () => {
    const loadExistingEvents = vi.fn().mockResolvedValue([]);
    const deps = silentDeps({
      loadConversation: vi.fn().mockResolvedValue({
        id: 'conv-a',
        contact_id: 'contact-a',
        ai_autoreply_disabled: false,
      }),
      loadMessages: vi
        .fn()
        .mockResolvedValue([message({ id: 'msg-1', content_text: 'hi' })]),
      loadExistingEvents,
    });
    await analyzeConversation(db, JOB, deps);
    expect(loadExistingEvents).toHaveBeenCalledWith(db, 'acct-a', 'conv-a');
  });

  it('defers a budget-exhausted conversation instead of hot-looping', async () => {
    const deferBudget = vi.fn().mockResolvedValue(undefined);
    const deps = silentDeps({
      loadConversation: vi.fn().mockResolvedValue({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadDailyUsage: vi.fn().mockResolvedValue({
        conversations: 100,
        tokens: 0,
      }),
      deferBudget,
    });
    const result = await analyzeConversation(db, JOB, deps);
    expect(result.reason).toBe('daily_conversation_budget');
    expect(deferBudget).toHaveBeenCalledWith(db, 'acct-a', 'conv-a');
    expect(deps.beginCursor).not.toHaveBeenCalled();
  });
});

describe('analysis cursor persistence', () => {
  it('passes separate deterministic/LLM watermarks and the exact completed trigger', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await upsertAnalysisCursor({ rpc } as never, {
      accountId: 'acct-a',
      conversationId: 'conv-a',
      deterministicMessageId: 'msg-2',
      deterministicCreatedAt: '2026-01-01T00:02:00.000Z',
      llmMessageId: 'msg-1',
      llmCreatedAt: '2026-01-01T00:01:00.000Z',
      advanceLlm: false,
      retryLlm: true,
      completedTrigger: { type: 'commerce', sourceId: 'payment:order-1' },
      errorCode: 'llm_provider_error',
    });
    expect(rpc).toHaveBeenCalledWith(
      'complete_conversation_analysis',
      expect.objectContaining({
        p_deterministic_message_id: 'msg-2',
        p_llm_message_id: 'msg-1',
        p_advance_llm: false,
        p_retry_llm: true,
        p_completed_trigger: {
          type: 'commerce',
          sourceId: 'payment:order-1',
        },
        p_error_code: 'llm_provider_error',
      })
    );
  });

  it('lets SQL resolve the real message timestamp when work starts', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await setCursorRunning({ rpc } as never, {
      accountId: 'acct-a',
      conversationId: 'conv-a',
      pendingMessageId: 'msg-1',
      pendingTrigger: { type: 'message', messageId: 'msg-1' },
    });
    expect(rpc).toHaveBeenCalledWith('start_conversation_analysis', {
      p_account_id: 'acct-a',
      p_conversation_id: 'conv-a',
      p_pending_message_id: 'msg-1',
      p_pending_trigger: { type: 'message', messageId: 'msg-1' },
    });
    expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_pending_created_at');
  });

  it('persists only a fixed error code, never exception text', async () => {
    const update = vi.fn();
    const secondEq = vi.fn().mockResolvedValue({ error: null });
    const firstEq = vi.fn().mockReturnValue({ eq: secondEq });
    update.mockReturnValue({ eq: firstEq });
    await markAnalysisFailed(
      { from: () => ({ update }) } as never,
      JOB,
      new Error('raw customer message must not be stored')
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ last_error: 'analysis_failed' })
    );
    expect(JSON.stringify(update.mock.calls)).not.toContain(
      'raw customer message must not be stored'
    );
  });
});

describe('analyzeConversation outcomes vs signals', () => {
  it('persists a paid order as outcomes and advances the cursor', async () => {
    const insertEvents = vi.fn().mockResolvedValue(2);
    const upsertCursor = vi.fn().mockResolvedValue(undefined);
    const extractLlm = vi.fn();
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents, upsertCursor, extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
        ai_autoreply_disabled: false,
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'thanks' }),
      ],
      loadCommerceOrders: async () => [
        { id: 'ord-1', status: 'processing', line_items: [] },
      ],
    });
    expect(insertEvents).toHaveBeenCalled();
    const rows = insertEvents.mock.calls[0][1] as Array<{
      event_type: string;
      kind: string;
    }>;
    expect(rows.map((r) => r.event_type).sort()).toEqual([
      'ORDER_CREATED',
      'PAYMENT_COMPLETED',
    ]);
    expect(rows.every((r) => r.kind === 'outcome')).toBe(true);
    expect(extractLlm).not.toHaveBeenCalled();
    expect(upsertCursor).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acct-a',
        conversationId: 'conv-a',
        deterministicMessageId: 'msg-1',
        deterministicCreatedAt: '2026-01-01T00:00:00.000Z',
        advanceLlm: true,
      })
    );
  });

  it('does not create ORDER_CREATED from looks good', async () => {
    const insertEvents = vi.fn().mockResolvedValue(0);
    const extractLlm = vi.fn();
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents, extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'looks good' }),
      ],
    });
    const rows = (insertEvents.mock.calls[0]?.[1] ?? []) as Array<{
      event_type: string;
    }>;
    expect(rows.some((r) => r.event_type === 'ORDER_CREATED')).toBe(false);
    expect(extractLlm).not.toHaveBeenCalled();
  });

  it('strips catalog ids that belong to another tenant before persist', async () => {
    const insertEvents = vi.fn().mockResolvedValue(1);
    await analyzeConversation(db, JOB, {
      ...silentDeps({
        insertEvents,
        loadOwnedRefs: async () => ({
          productIds: new Set<string>(),
          variantIds: new Set<string>(),
        }),
      }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'too expensive' }),
      ],
      loadCatalogEvents: async () => [
        { id: 'cat-1', event: 'add_to_cart', product_id: 'foreign-prod' },
      ],
    });
    const rows = insertEvents.mock.calls[0][1] as Array<{
      metadata: { productId?: string };
    }>;
    expect(rows.some((row) => row.metadata.productId === 'foreign-prod')).toBe(
      false
    );
  });

  it('does not call the LLM on an empty greeting', async () => {
    const extractLlm = vi.fn();
    await analyzeConversation(db, JOB, {
      ...silentDeps({ extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [message({ id: 'msg-1', content_text: 'ok' })],
    });
    expect(extractLlm).not.toHaveBeenCalled();
  });

  it('keeps deterministic rows without spending LLM budget when confidence is high', async () => {
    const insertEvents = vi.fn().mockResolvedValue(1);
    const extractLlm = vi.fn().mockResolvedValue({
      events: [],
      usage: null,
      status: 'success',
    });
    await analyzeConversation(db, JOB, {
      ...silentDeps({ insertEvents, extractLlm }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadMessages: async () => [
        message({
          id: 'msg-1',
          content_text: 'how much does this red saree cost?',
        }),
      ],
      loadAiConfig: async () => ({ apiKey: 'sk' }) as never,
      loadControls: async () => ({
        mode: 'hybrid',
        paused: false,
        dailyConversationLimit: 100,
        dailyTokenLimit: 25000,
      }),
    });
    expect(extractLlm).not.toHaveBeenCalled();
    const rows = insertEvents.mock.calls[0][1] as Array<{ event_type: string }>;
    expect(rows.some((r) => r.event_type === 'ORDER_CREATED')).toBe(false);
  });

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
    ];
    const insertEvents = vi.fn().mockResolvedValue(0);
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
    });
    const rows = (insertEvents.mock.calls[0]?.[1] ?? []) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('uses the learning-only LLM boundary for uncertain hybrid turns and logs usage', async () => {
    const extractLlm = vi.fn().mockResolvedValue({
      events: [
        {
          eventType: 'HESITATION',
          kind: 'signal',
          confidence: 0.8,
          metadata: {},
          sourceMessageId: 'msg-1',
          sourceTable: 'messages',
          sourceId: 'msg-1',
        },
      ],
      usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
      status: 'success',
    });
    const logUsage = vi.fn().mockResolvedValue(undefined);
    await analyzeConversation(db, JOB, {
      ...silentDeps({ extractLlm, logUsage }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: null,
      }),
      loadMessages: async () => [
        message({
          id: 'msg-1',
          content_text:
            'I am unsure whether this would work for the ceremony next month',
        }),
      ],
      loadControls: async () => ({
        mode: 'hybrid',
        paused: false,
        dailyConversationLimit: 100,
        dailyTokenLimit: 25000,
      }),
      loadAiConfig: async () =>
        ({
          provider: 'openai',
          model: 'learning-model',
          apiKey: 'test',
        }) as never,
    });
    expect(extractLlm).toHaveBeenCalledTimes(1);
    expect(logUsage).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        mode: 'conversation_analysis',
        purpose: 'structured_sales_event_extraction',
        analyzerVersion: expect.any(String),
        usage: { promptTokens: 20, completionTokens: 8, totalTokens: 28 },
      })
    );
  });

  it('advances deterministic progress while retrying a failed LLM batch', async () => {
    const upsertCursor = vi.fn().mockResolvedValue(undefined);
    const extractLlm = vi
      .fn()
      .mockResolvedValueOnce({
        events: [],
        usage: null,
        status: 'provider_error',
      })
      .mockResolvedValueOnce({
        events: [],
        usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        status: 'success',
      });
    const loadCursor = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        last_source_message_id: 'msg-1',
        last_source_created_at: '2026-01-01T00:00:00.000Z',
        last_llm_source_message_id: null,
        last_llm_source_created_at: null,
      });
    const deps = silentDeps({
      upsertCursor,
      extractLlm,
      loadCursor,
      loadConversation: async () => ({ id: 'conv-a', contact_id: 'contact-a' }),
      loadMessages: async () => [
        message({
          id: 'msg-1',
          content_text:
            'I am unsure whether this works for the ceremony next month',
        }),
      ],
      loadControls: async () => ({
        mode: 'hybrid',
        paused: false,
        dailyConversationLimit: 100,
        dailyTokenLimit: 25000,
      }),
      loadAiConfig: async () =>
        ({
          provider: 'openai',
          model: 'learning-model',
          apiKey: 'test',
        }) as never,
    });

    await analyzeConversation(db, JOB, deps);
    expect(upsertCursor).toHaveBeenNthCalledWith(
      1,
      db,
      expect.objectContaining({
        deterministicMessageId: 'msg-1',
        llmMessageId: 'msg-1',
        advanceLlm: false,
        retryLlm: true,
        errorCode: 'llm_provider_error',
      })
    );

    await analyzeConversation(db, JOB, deps);
    expect(extractLlm).toHaveBeenCalledTimes(2);
    expect(upsertCursor).toHaveBeenNthCalledWith(
      2,
      db,
      expect.objectContaining({
        deterministicMessageId: 'msg-1',
        llmMessageId: 'msg-1',
        advanceLlm: true,
        retryLlm: false,
        errorCode: null,
      })
    );
  });

  it('advances the LLM watermark in deterministic-only mode', async () => {
    const upsertCursor = vi.fn().mockResolvedValue(undefined);
    await analyzeConversation(db, JOB, {
      ...silentDeps({ upsertCursor }),
      loadConversation: async () => ({ id: 'conv-a', contact_id: 'contact-a' }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'first useful customer message' }),
        message({
          id: 'msg-2',
          content_text: 'second useful customer message',
          created_at: '2026-01-01T00:01:00.000Z',
        }),
      ],
    });
    expect(upsertCursor).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        deterministicMessageId: 'msg-2',
        llmMessageId: 'msg-2',
        advanceLlm: true,
        retryLlm: false,
      })
    );
  });

  it('runs pattern shadow observation only on the background delta', async () => {
    const observePatterns = vi.fn().mockResolvedValue(1);
    await analyzeConversation(db, JOB, {
      ...silentDeps({ observePatterns }),
      loadConversation: async () => ({
        id: 'conv-a',
        contact_id: 'contact-a',
      }),
      loadCursor: async () => ({
        last_source_message_id: 'msg-1',
        last_source_created_at: '2026-01-01T00:00:00.000Z',
        last_llm_source_message_id: 'msg-1',
        last_llm_source_created_at: '2026-01-01T00:00:00.000Z',
      }),
      loadMessages: async () => [
        message({ id: 'msg-1', content_text: 'old context' }),
        message({
          id: 'msg-2',
          content_text: 'too expensive',
          created_at: '2026-01-01T00:01:00.000Z',
        }),
      ],
    });
    expect(observePatterns).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acct-a',
        turns: [expect.objectContaining({ id: 'msg-2' })],
      })
    );
  });
});
