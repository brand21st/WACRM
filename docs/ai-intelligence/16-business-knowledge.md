# 16. Business Knowledge Intelligence (Phase 2)

Phase 2 adds a tenant-scoped **Business Knowledge Intelligence**
layer on top of the existing knowledge base, Shopify store content,
and WACRM catalog. It does **not** change live WhatsApp auto-reply
and does **not** implement conversation learning.

Runtime:

- [`src/lib/ai/intelligence/knowledge-contracts.ts`](../../src/lib/ai/intelligence/knowledge-contracts.ts)
- [`src/lib/ai/intelligence/knowledge-sources.ts`](../../src/lib/ai/intelligence/knowledge-sources.ts)
- [`src/lib/ai/intelligence/knowledge-context.ts`](../../src/lib/ai/intelligence/knowledge-context.ts)

Entry point: `retrieveBusinessKnowledge({ accountId, query, category?, contactId?, limit? })`.

The unused `buildAIContext` composer now also attaches a
`businessKnowledge` snapshot. `dispatchInboundToAiReply` is **not**
wired to it.

## Purpose

```
Customer query
    → retrieveBusinessKnowledge(accountId, …)
    → Knowledge Base + store content + catalog
    → BusinessKnowledgeSnapshot
    → future AI orchestration (Phase 5)
```

`accountId` is mandatory. Tenant filtering happens at each source
query (`p_account_id` / `.eq('account_id', …)` / `searchCatalog({ accountId })`).
Never search globally and filter afterward.

## Source priority

Lower rank wins when facts conflict.

| Rank | Source | Existing data |
|------|--------|---------------|
| 1 | `manual_kb` | `ai_knowledge_documents.source_type = 'manual'` |
| 2 | `catalog` | `searchCatalog` product title / price / stock |
| 3 | `store_policy` | `searchStoreContent` `kind = 'policy'` |
| 4 | `url_kb` | `source_type = 'url'` |
| 4 | `store_page` | `kind = 'page'` |
| 5 | `generic_model` | **never retrieved** |

Empty snapshot means “this business has no matching knowledge,” not
“the model may invent a policy.”

## Confidence

Deterministic, not an ML score:

- `high` — manual KB or store policy with an excerpt
- `medium` — URL KB, store page, or catalog with price/stock
- `low` — catalog title only
- `unknown` — empty excerpt

## Conflict handling

Only policy-like categories: RETURN, REFUND, EXCHANGE, SHIPPING,
DELIVERY, PAYMENT, DISCOUNT.

Compare the first `{number} {days|hours|%|inr}` token in each excerpt.
Different tokens in the same category:

- Different source ranks → keep the more authoritative result
- Same rank → `unresolved: true` and keep both refs

Do not merge prose into a made-up policy.

## Categories

Application-level hints classified from title / excerpt / query.
Documents are **not** migrated or re-tagged in the database.

## BusinessKnowledgeSnapshot

Not a table. Holds short excerpts and refs (`documentId`, `chunkId`,
`handle`, `productId`), plus `catalogProductIds` and any conflicts.
`contactId` is stored for future orchestration; Phase 2 does not
read customer memory.

## Tenant isolation

- `requireAccountId` before any loader
- Document metadata joined with `.eq('account_id', accountId)`
- Catalog hits from another `accountId` are dropped
- No cross-tenant cache
- Service-role callers must still pass a trusted `accountId`

## What Phase 2 does not implement

- `sales_events` / `sales_patterns`
- Conversation analyzer or learning worker
- Outcome scoring
- Live auto-reply / WhatsApp / checkout / recommend changes
- Schema migrations
- Per-tenant models

## Phase 3 (separate layer)

Conversation analysis now emits structured `sales_events`. Those events
must **not** replace this layer. See
[Conversation Intelligence](./17-conversation-intelligence.md). The path is:

```
Conversation → Analyzer → Sales Events → Sales Patterns
     → Tenant Sales Brain
     → Business Knowledge Intelligence (this snapshot)
     → AI orchestration
```
