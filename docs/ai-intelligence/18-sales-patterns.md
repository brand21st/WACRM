# 18. Tenant Sales Patterns (Phase 4)

Phase 4 discovers **evidence-backed, tenant-scoped sales patterns**
from Phase 3 `sales_events`. It does **not** change live AI replies,
prompts, checkout, catalog recommend, or follow-up.

```
sales_events
  → HTTP cron / BullMQ ai-sales-pattern-discover
  → deterministic aggregation (conversation = sample)
  → sales_patterns
       ⇢ Phase 5 retrieval (read-only)
```

Phase 2 still answers “what does this business know?”
Phase 4 answers “what sales patterns have we observed here?”
Keep the layers separate.

Runtime:

- [`src/lib/ai/intelligence/sales-pattern-types.ts`](../../src/lib/ai/intelligence/sales-pattern-types.ts)
- [`src/lib/ai/intelligence/sales-pattern-identity.ts`](../../src/lib/ai/intelligence/sales-pattern-identity.ts)
- [`src/lib/ai/intelligence/aggregate-sales-events.ts`](../../src/lib/ai/intelligence/aggregate-sales-events.ts)
- [`src/lib/ai/intelligence/discover-patterns.ts`](../../src/lib/ai/intelligence/discover-patterns.ts)
- [`src/app/api/ai/patterns/cron/route.ts`](../../src/app/api/ai/patterns/cron/route.ts)

## What a pattern is

A row describes: when this signal appears (type + limited context),
what terminal outcomes followed, and a **strategy enum** such as
`OFFER_RELEVANT_ALTERNATIVE` — not a generated sales script.

## Event → pattern

1. Load up to 5000 newest `sales_events` for **one** `account_id`.
2. Group by `conversation_id`.
3. Terminal success: `ORDER_CREATED` or `PAYMENT_COMPLETED` (`kind = outcome`).
4. Terminal failure: `ORDER_CANCELLED` or `CHECKOUT_ABANDONED` if no success.
5. Else unresolved (silence, “looks good”, “nice”, `PURCHASE_INTENT` alone).
6. Map signals to a small taxonomy; skip greetings / mid-funnel-only threads.
7. Bucket by `pattern_key`. Upsert. Recompute is always from events.

## Outcome rules

| Data | Result |
|------|--------|
| `ORDER_CREATED` / `PAYMENT_COMPLETED` | success |
| `ORDER_CANCELLED` / `CHECKOUT_ABANDONED` (no success) | failure |
| `CART_CREATED` / `CHECKOUT_STARTED` only | unresolved |
| “looks good” / “nice” / silence | unresolved |

An LLM never decides a sale when a trusted commerce outcome exists.

## Evidence and success rate

Conversation is the sample unit.

```
successRate = successCount / eligibleOutcomeCount
eligibleOutcomeCount = successCount + failureCount
```

Unresolved conversations are **not** in the denominator.
100 threads / 20 paid / 10 abandoned / 70 open → **20/30**, not 20%.

`confidence` (v1): `eligible / (eligible + 5)`.

## Minimum evidence and lifecycle

| Status | Rule |
|--------|------|
| (no row) | `sampleCount < 3` |
| `candidate` | ≥ 3 samples, not yet active |
| `active` | ≥ 8 samples **and** ≥ 5 eligible outcomes |
| `stale` | `lastObservedAt` older than 90 days |
| `archived` | `lastObservedAt` older than 180 days |

Archiving does not delete `sales_events` or the pattern row.

## Pattern identity

```
accountId|patternType|triggerEventType|category|priceBand|productId
```

No timestamps, language, color, or size. The same business/context
updates the same row (`UNIQUE (account_id, pattern_key)`).

`productId` is added only when that product has ≥ 8 conversations in
the bucket. Category comes only from event metadata. Price band comes
from `budgetMax` or one batched catalog `price_min` lookup (cap 200).

## Tenant isolation

Every query uses `.eq('account_id', accountId)` **then** groups.
No global `GROUP BY event_type`. Service-role workers still pass the
job’s `accountId`. Members can `SELECT` their account’s rows via RLS;
writes are service-role only.

## Freshness and recompute

`first_observed_at` / `last_observed_at` come from events.
`last_evaluated_at` is the job time. Each job fully recomputes from
the event window and upserts. Fix a bug, re-run cron — stats rebuild.

## Privacy

No phones, emails, addresses, tokens, payment credentials, or raw
transcripts. Context is category / price band / optional product id /
strategy enum.

## What Phase 4 does not do

- Modify auto-reply prompts or WhatsApp behavior
- Auto-apply discounts, prices, or product picks
- Cross-tenant / global “winning” patterns
- Per-tenant models
- Phase 5 retrieval (see [19](./19-sales-pattern-retrieval.md); default flag is `off`)

## Phase 5

Phase 5 loads **active** patterns with `.eq('account_id', accountId)`
via `retrieveSalesPatterns`. Live prompts read them only when
`sales_pattern_retrieval = on`. See
[Tenant Sales Pattern Retrieval](./19-sales-pattern-retrieval.md).
