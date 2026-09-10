# 20. Sales pattern effectiveness (Phase 6)

Phase 6 closes the feedback loop with **observational evidence**.

**Pattern performance is observational evidence and does not establish
causal impact.**

```
Phase 5 injects (flag = on, LLM path)
  → sales_pattern_usages
  → later Phase 3 terminal sales_events
  → evaluateAccountPatternEffectiveness
  → sales_patterns.effectiveness
  → retrieval_eligible
  → future Phase 5 retrieval
```

Phase 6 does **not** train models, rewrite prompts, generate
strategies, change prices, or modify checkout.

Runtime:

- [`src/lib/ai/intelligence/record-sales-pattern-usage.ts`](../../src/lib/ai/intelligence/record-sales-pattern-usage.ts)
- [`src/lib/ai/intelligence/evaluate-pattern-effectiveness.ts`](../../src/lib/ai/intelligence/evaluate-pattern-effectiveness.ts)
- [`src/lib/ai/intelligence/pattern-effectiveness-types.ts`](../../src/lib/ai/intelligence/pattern-effectiveness-types.ts)
- Queue: `ai-sales-pattern-effectiveness`
- Cron: [`GET /api/ai/patterns/cron`](../../src/app/api/ai/patterns/cron/route.ts)

## Usage vs retrieval

| Phase 5 mode | Retrieved | Injected into customer prompt | Usage row |
|--------------|-----------|-------------------------------|-----------|
| `off` | No | No | No |
| `shadow` | Yes | No | **No** |
| `on` + LLM reply | Yes | Yes | **Yes** |
| `on` + fact-reply (no LLM) | Yes | No | **No** |

Effectiveness attribution applies to **injected** usages only.

## Verified outcomes

Read existing Phase 3 `sales_events` (`kind = outcome`):

- Success: `ORDER_CREATED`, `PAYMENT_COMPLETED`
- Failure: `ORDER_CANCELLED`, `CHECKOUT_ABANDONED`

Not success or failure: `CART_CREATED`, `CHECKOUT_STARTED`,
`PURCHASE_INTENT`, “looks good”, silence.

## Attribution window

- Same `account_id` and `conversation_id`
- Outcome `created_at` **after** `used_at`
- Outcome `created_at` within **7 days** of first injection
- Latest terminal outcome in the window wins
- Outcome before injection: ignored
- No terminal outcome: `unresolved` (not failure)

Multiple injected patterns in one conversation share the same
observational association. That is **not** independent causal credit.

Repeat injection of the same pattern in one conversation does not
create a second row (`UNIQUE (account_id, pattern_id, conversation_id)`).
`used_at` stays on the first injection.

## Effectiveness metrics

```
observedSuccessRate = successCount / (successCount + failureCount)
```

Unresolved usages are excluded. Metrics live on
`sales_patterns.effectiveness` and do **not** overwrite Phase 4
`evidence.successRate`.

**Observed lift / baseline is omitted in v1.** There is not enough
safe unused-conversation matching to report a lift without inventing
one.

## Lifecycle

Phase 4 still owns `status` (candidate / active / stale / archived)
from event samples. Phase 6 only flips `retrieval_eligible`:

- Fewer than 5 eligible usages → leave eligibility unchanged
- 5+ eligible and rate < 0.25 → `retrieval_eligible = false`
- 5+ eligible and rate ≥ 0.25 → `retrieval_eligible = true`

Phase 5 retrieves `status = active` **and** `retrieval_eligible = true`.

## Feature flags

- `sales_pattern_retrieval` (Phase 5) controls injection and therefore
  whether usage rows are created.
- `sales_pattern_effectiveness` (Phase 6, default **off**):
  - `off` / `shadow`: recompute metrics; do not flip eligibility
  - `on`: also write `retrieval_eligible`

## Recomputation and idempotency

Each job reloads usages and terminal events and rewrites attribution
and metrics. Re-running with the same evidence produces the same
numbers. No incremental counters.

## Privacy

Usage rows store tenant IDs, pattern IDs, conversation/message
references, timestamps, and outcome references. No transcripts,
phones, emails, addresses, or payment credentials.

## Failure and performance

Usage upsert is fire-and-forget on the live path. Evaluation is
async (cron / BullMQ). 0 LLM calls. Customer replies never wait on
the effectiveness job.

## Rollback

1. `sales_pattern_effectiveness = off`
2. `UPDATE sales_patterns SET retrieval_eligible = true`
3. `sales_pattern_retrieval = off` to stop new usage rows

Do not delete usages, events, or patterns.

## Phase 7

Phase 6 only changes which existing patterns remain retrievable.
It is not automatic prompt optimization or per-tenant model training.
