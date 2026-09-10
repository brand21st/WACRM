# 19. Tenant sales pattern retrieval (Phase 5)

Phase 5 retrieves **relevant active sales patterns** for one tenant and
makes them available to the existing AI reply path as **behavioral
hints**.

**Sales patterns are behavioral hints, not business facts or
authorization.**

```
sales_patterns (active, this account only)
  → retrieveSalesPatterns
  → compact DTO
  → optional Business Sales Guidance in buildSystemPrompt
  → existing generateReply
```

Phase 5 does **not** create or update patterns, run Phase 4 discovery,
train models, rewrite global prompts, change prices, or change
checkout / recommend / follow-up.

Runtime:

- [`src/lib/ai/intelligence/retrieve-sales-patterns.ts`](../../src/lib/ai/intelligence/retrieve-sales-patterns.ts)
- [`src/lib/ai/intelligence/sales-pattern-score.ts`](../../src/lib/ai/intelligence/sales-pattern-score.ts)
- [`src/lib/ai/intelligence/sales-pattern-prompt.ts`](../../src/lib/ai/intelligence/sales-pattern-prompt.ts)
- Live wire: [`src/lib/ai/auto-reply.ts`](../../src/lib/ai/auto-reply.ts)

## Architecture

Caller / auto-reply owns the feature flag:

```
classifySalesTurn + shopping
  → loadSalesPatternRetrievalMode(accountId)
  → off? do not query
  → stay / greeting / language-picker? do not query
  → retrieveSalesPatterns(...)   // 0 or 1 query
  → shadow: log, do not inject
  → on: inject max 3 into buildSystemPrompt
```

`retrieveSalesPatterns()` means only: retrieve relevant **active**
patterns for this tenant and current context. It does **not** silently
no-op because the global flag is off.

`buildAIContext` is **not** used by live auto-reply. It may attach
already-retrieved `deps.salesPatterns`. It does **not** query
`sales_patterns`. One customer turn results in at most one pattern
query.

## Retrieval boundary

- `requireAccountId` before any database query
- `.eq('account_id', accountId)` then `.eq('status', 'active')`
- Poisoned rows from another account are dropped after fetch
- `accountId` comes from trusted server-side context, never customer text
- Service-role code still filters by `account_id` (RLS is bypassed)

Eligible in v1: `status = 'active'` only. Phase 4 owns lifecycle
(`candidate` / `stale` / `archived` are ignored).

Query:

```
sales_patterns
  .eq('account_id', accountId)
  .eq('status', 'active')
  .order('last_observed_at', desc)
  .limit(40)
```

Then score in memory, drop score < 25, return top 3.

## Feature flag

`ai_configs.sales_pattern_retrieval`: `off` | `shadow` | `on`.
Default **`off`**. Loader:
[`loadSalesPatternRetrievalMode`](../../src/lib/ai/intelligence/retrieve-sales-patterns.ts).
Missing row, missing column, or unknown value → `off`.

| Mode | Query | Inject into customer prompt | Diagnostics |
|------|-------|-----------------------------|-------------|
| `off` | No | No | None |
| `shadow` | Yes, if the turn is eligible | No | Safe metadata, `injected: false` |
| `on` | Yes, if the turn is eligible | Yes, max 3 | Same metadata, `injected: true` |

## Scoring

Deterministic. No LLM ranking.

```
+40  exact patternType or triggerEventType match
+12  GENERAL_SALES only when the derived type is also GENERAL_SALES
     (v1 auto-reply never derives GENERAL_SALES)
+15  category match (structured shopping.categoryHint only)
+10  priceBand or budgetBand match (priceBandForAmount(shopping.maxPrice))
+8   productId match
+min(20, eligibleOutcomeCount)
+confidence * 10
+3   last_observed_at within 30 days
```

Minimum score: 25. Product match is **not** a knockout. A strong
category pattern with more eligible outcomes can beat a weak
product-specific pattern.

Unrelated types with no context overlap are excluded.

Context is taken only from existing structured fields. Phase 5 does
not invent category from a product title or price band from free text.

## Turn mapping

Reuses existing `classifySalesTurn`. No new classifier.

| Existing kind | Derived type | Retrieve? |
|---------------|--------------|-----------|
| `purchase` | `PURCHASE_INTENT` | yes |
| `substitution` + price hint | `PRICE_OBJECTION` | yes |
| `substitution` otherwise | `PRODUCT_OBJECTION` | yes |
| `product_switch` | `PRODUCT_OBJECTION` | yes |
| `comparison` | `PRODUCT_COMPARISON` | yes |
| `product_question` | `PRODUCT_INQUIRY` | yes |
| `variant_change` | `PRODUCT_INQUIRY` | yes |
| `budget_change` | `PRICE_OBJECTION` | yes |
| `preference_change` | none | no |
| `stay` / greeting / show-more / language-picker | none | no |

`GENERAL_SALES` is not retrieved in v1.

## Business Knowledge priority

1. Current customer request / conversation
2. Current structured product / catalog facts
3. Business knowledge / policies
4. Customer memory / sales snapshot
5. Historical sales guidance
6. Generic model knowledge

If a sales pattern conflicts with a business fact, **ignore the sales
pattern for that decision**.

## Sales guidance safety

A strategy such as `EXPLAIN_VALUE_BEFORE_DISCOUNT` does **not** mean
a discount is allowed. Historical behavior never authorizes a
discount, price change, free shipping, refund, exception, or special
offer.

The customer must never see internal pattern names, past-customer
language, conversion rates, or “our model learned”. Existing
tone/language behavior still writes Malayalam / Tamil / Hindi /
English.

## Privacy

The retrieved object is a compact DTO: pattern id, type, trigger,
context tokens, recommended behavior, confidence, sample counts,
success rate, match score, match reasons.

No PII, phone, email, address, payment data, raw transcript, or
customer quote.

Shadow/on diagnostics log only `accountId`, `patternId`,
`patternType`, `matchScore`, `matchReasons`, `injected`. They do not
log the customer message, name, phone, email, address, transcript, or
prompt.

## Failure behavior

Table missing, column missing, query failure, scoring/mapping
failure → `salesPatterns = []` and the normal reply continues.
Pattern retrieval is optional intelligence, not a reply dependency.

## Performance

- Flag `off` or skip turn → 0 queries
- Eligible turn → 1 bounded query (`LIMIT 40`)
- Max 3 injected patterns
- 0 LLM ranking calls
- 0 per-pattern queries
- 0 catalog lookups for scoring
- Uses existing `(account_id, status, last_observed_at)` index

## Cache

**No cache in v1.** Retrieval is already bounded and tenant-scoped.
If a future cache is added, `accountId` must be part of the key.

## Live auto-reply integration

Only [`dispatchInboundToAiReply`](../../src/lib/ai/auto-reply.ts) is
wired. Draft, playground, live-call, and follow-up stay unwired.

The full-agent retry reuses the same `salesGuidance` string. It does
not retrieve again.

Auto-reply was **not** migrated onto `buildAIContext`.

## Rollback

Set `ai_configs.sales_pattern_retrieval = 'off'`. Customer-facing
behavior returns to the previous state. Phase 5 does not mutate
`sales_patterns`. Do not delete pattern rows on rollback.

## Phase 6 relationship

Phase 5 ends at: retrieve → optional prompt hints → existing reply.

Phase 6 records **injected** usages and may set
`retrieval_eligible = false` so Phase 5 stops retrieving
underperforming patterns. See
[Sales Pattern Effectiveness](./20-pattern-effectiveness.md).
