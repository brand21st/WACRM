# 17. Conversation Intelligence (Phase 3)

Phase 3 turns persisted WhatsApp conversations into **structured,
tenant-isolated sales events**. It does **not** build the Sales Brain,
does **not** write `sales_patterns`, and does **not** change live AI
replies.

```
Inbound WhatsApp message
  → persist message
  → live AI / flows                    (unchanged)
  → BullMQ ai-conversation-analyze     (fire-and-forget)
       → analyzer worker
       → sales_events
            ⇢ Phase 4 Sales Brain (later)
```

The live reply never waits on the analyzer. Redis down → enqueue
returns `false` (same as catalog-embed); chat continues. The next
successful job for that conversation advances the cursor and backfills
unprocessed turns.

Runtime:

- [`src/lib/ai/intelligence/sales-event-types.ts`](../../src/lib/ai/intelligence/sales-event-types.ts)
- [`src/lib/ai/intelligence/sales-event-schema.ts`](../../src/lib/ai/intelligence/sales-event-schema.ts)
- [`src/lib/ai/intelligence/extract-deterministic.ts`](../../src/lib/ai/intelligence/extract-deterministic.ts)
- [`src/lib/ai/intelligence/extract-llm.ts`](../../src/lib/ai/intelligence/extract-llm.ts)
- [`src/lib/ai/intelligence/analyze-conversation.ts`](../../src/lib/ai/intelligence/analyze-conversation.ts)
- [`src/lib/queue/processors/ai-conversation-analyze.ts`](../../src/lib/queue/processors/ai-conversation-analyze.ts)

Entry point: `enqueueAiConversationAnalyze` after the **first** inbound
persist, and after a successful paid transition in
[`src/lib/commerce/payment.ts`](../../src/lib/commerce/payment.ts).
`auto-reply.ts` is not a trigger.

## What is stored

`sales_events` holds typed signals and verified outcomes with message /
commerce refs, analyzer version `v1`, and idempotent unique keys.

`kind = 'outcome'` only for commerce / catalog verified rows.
Everything else is `signal`.

Metadata keys only: `productId`, `variantId`, `budgetMax`, `color`,
`size`, `category`, `objectionType`. No raw transcript, phone, name, or
payment credentials.

## Tenant isolation

- Job `accountId` comes from webhook / WhatsApp config, never from
  message text.
- Conversation load requires **both** `id` and `account_id`.
- Every SELECT / INSERT uses `.eq('account_id', accountId)`.
- Account A analyzing conversation B writes nothing.

## Analysis window

Last 8 messages for context, plus up to 20 unprocessed customer /
order / interactive turns after
`conversation_analysis_cursors`. Cursor advances after successful
writes. Unique indexes make retries no-ops.

## Deterministic vs LLM

Most turns are deterministic: inbound carts, commerce statuses,
catalog add-to-cart / purchase, `classifySalesTurn`, shopping-context
diffs (read-only).

At most **one** `generateReply` call per job (`skipSpokenRewrite:
true`). Phase 2 `retrieveBusinessKnowledge` is **not** called. Invalid
JSON writes zero LLM rows; deterministic events and the cursor still
commit.

Skip LLM when there is no customer text, a greeting / “looks good”
with ≤ 3 tokens, only `wacrm:` button ids, or a deterministic
**outcome** already exists for the turn.

“Looks good” / “nice” is never `ORDER_CREATED`. “I’ll take this” is
`PURCHASE_INTENT` / `READY_TO_BUY` (signal).

## Phase 4

Phase 4 aggregates `sales_events` per `account_id` into
`sales_patterns`. See [Tenant Sales Patterns](./18-sales-patterns.md).
Live prompts do not read `sales_events` or `sales_patterns` yet.
