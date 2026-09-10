# 9. Retrieval boundary

Every retrieve function starts with `accountId`.

## Compliant loaders today

| Function | File | First tenant arg |
|----------|------|------------------|
| `retrieveKnowledge` | `src/lib/ai/knowledge.ts` | `accountId` |
| `retrieveShopifyStoreContent` | `src/lib/shopify/store-content.ts` | `accountId` |
| `loadContactMemory` | `src/lib/ai/chat-memory.ts` | `accountId` |
| `loadShoppingContext` | `src/lib/catalog/intelligence/shopping-context.ts` | `accountId` |
| `matchCatalogSemantic` | `src/lib/catalog/search/semantic.ts` | `accountId` |
| `retrieveBusinessKnowledge` | `src/lib/ai/intelligence/knowledge-context.ts` | `accountId` |
| `retrieveSalesPatterns` | `src/lib/ai/intelligence/retrieve-sales-patterns.ts` | `accountId` |
| `recordSalesPatternUsage` | `src/lib/ai/intelligence/record-sales-pattern-usage.ts` | `accountId` |
| `evaluateAccountPatternEffectiveness` | `src/lib/ai/intelligence/evaluate-pattern-effectiveness.ts` | `accountId` |

SQL RPCs take `p_account_id` first and filter in the `WHERE` clause.

## Contract

```ts
interface RetrievalQuery {
  accountId: string // required; first filter
  layer: IntelligenceLayer
  contactId?: string
  conversationId?: string
  query?: string
}
```

`requireAccountId()` throws if `accountId` is missing. Future
helpers must call it before querying.

## Forbidden

- Embed the whole corpus, then filter by tenant in application code.
- Customer-global memory keyed only by phone across accounts.
- A `sales_patterns` table without `account_id`.

## Phase 2 composer

`retrieveBusinessKnowledge` is the unified business-knowledge boundary.
It requires `accountId`, then retrieves KB + store content + catalog
for that account only. See [Business Knowledge Intelligence](./16-business-knowledge.md).

## Phase 3 analyzer

`analyzeConversation` loads a conversation with both `id` and
`account_id`, then writes `sales_events` for that tenant only. It does
**not** call `retrieveBusinessKnowledge`. See
[Conversation Intelligence](./17-conversation-intelligence.md).

## Phase 4 discovery

`discoverAccountPatterns` loads `sales_events` with
`.eq('account_id', accountId)` then aggregates. It does **not**
retrieve patterns into live chat. See
[Tenant Sales Patterns](./18-sales-patterns.md).

## Phase 5 retrieval

`retrieveSalesPatterns` requires `accountId`, then loads **active**
and `retrieval_eligible` `sales_patterns` with
`.eq('account_id', accountId)`. Live auto-reply calls it at most
once per turn after `loadSalesPatternRetrievalMode`.
`buildAIContext` may attach already-retrieved patterns; it does not
query `sales_patterns`.
See [Tenant Sales Pattern Retrieval](./19-sales-pattern-retrieval.md)
and [Sales Pattern Effectiveness](./20-pattern-effectiveness.md).
