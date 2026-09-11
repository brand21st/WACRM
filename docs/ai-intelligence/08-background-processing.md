# 8. Background processing design

Reuse BullMQ + existing HTTP crons. Do not add Inngest or a second
queue product.

## Existing queues

| Queue | Job id | Role |
|-------|--------|------|
| `ai-chat-reply` | `messageId` | Live customer reply |
| `ai-voice-inbound` | `messageId` | STT then reply |
| `call-recording` | `callId` | Recording ingest |
| `knowledge-scrape` | scrape `jobId` | KB URL crawl |
| `catalog-meta-sync` | `outboxId` | Meta catalog outbox |
| `catalog-embed` | `productId` | Product embeddings |
| `ai-conversation-follow-up` | `followUpId` | Silent-thread follow-up |
| `ai-conversation-analyze` | unique `runId`; short-lived dedup `${accountId}:${conversationId}` (6s, replace) | Phase 3 sales-event extraction |
| `ai-sales-pattern-discover` | `${accountId}:patterns` | Phase 4 pattern aggregation |
| `ai-sales-pattern-effectiveness` | `${accountId}:effectiveness` | Phase 6 observational effectiveness |

Every payload already includes `accountId`.

## Patterns to copy in Phase 3

- Custom BullMQ `jobId` so duplicates are ignored
- Redis down → inline `after()` or Postgres fallback; chat still works
- Non-critical failures swallowed (`logAiUsage`, knowledge retrieve,
  catalog analytics)
- Worker process: `src/worker.ts` / `npm run worker`

## Phase 1

No new queue name. No analyzer worker.

## Phase 3

One new queue name on the existing worker: `ai-conversation-analyze`,
plus `conversation_analysis_cursors`. Enqueue **after** inbound persist
(and after a paid commerce transition). Redis down → `false`; do not
inline-analyze on the webhook.

See [Conversation Intelligence](./17-conversation-intelligence.md).

## Phase 4

HTTP cron `GET /api/ai/patterns/cron` selects due accounts and
enqueues `ai-sales-pattern-discover` and
`ai-sales-pattern-effectiveness`. Redis down → run those jobs
**inline** (safe: not on the WhatsApp path). See
[Tenant Sales Patterns](./18-sales-patterns.md) and
[Sales Pattern Effectiveness](./20-pattern-effectiveness.md).

## Error isolation

If the future analyzer is down, WhatsApp AI chat continues. See
[failure isolation](./11-failure-isolation.md).
