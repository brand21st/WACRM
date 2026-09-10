# Vachat AI intelligence foundation

Phase 1 froze the multi-tenant AI architecture. Phase 2 adds a
tenant-scoped **Business Knowledge Intelligence** layer on top of the
existing KB, store content, and catalog. Phase 3 adds a background
conversation analyzer that writes tenant-scoped `sales_events`. Live
auto-reply is still unchanged.

**This is not a new AI system.** Vachat already has tenant-scoped
knowledge, customer memory, catalog RAG, and BullMQ workers. Phase 1
documents those layers, publishes TypeScript contracts, and adds a thin
unused `buildAIContext` composer. Phase 2 adds `retrieveBusinessKnowledge`
and a `BusinessKnowledgeSnapshot`. Phase 3 extracts conversation
signals after persist. Phase 4 aggregates those events into
tenant-scoped `sales_patterns`. Phase 5 can retrieve **active**
patterns into live auto-reply as behavioral hints, behind
`sales_pattern_retrieval` (default **off**). Phase 6 records injected
usage and may flip `retrieval_eligible` behind
`sales_pattern_effectiveness` (default **off**). It does **not** train
models.

## Layers (do not mix)

| Layer | What it is | Source of truth |
|-------|------------|-----------------|
| Raw data | Messages, orders, catalog events | `messages`, commerce, analytics tables |
| Business knowledge | What the business knows | `ai_knowledge_*`, `shopify_store_content` |
| Customer memory | What Vachat knows about one customer | `contact_ai_memory` |
| Conversation history | What was said in a thread | `conversations` + `messages` |
| Conversation intelligence | What happened in this conversation | `sales_events` (Phase 3) |
| Learned intelligence | Patterns from many conversations | `sales_patterns` (Phase 4) |
| AI context | What the LLM sees for this turn | Ephemeral; assembled at reply time |

## Tenant rule

Every intelligence read/write starts with `accountId` (`accounts.id`).
Business A never retrieves Business B's conversations, customers,
knowledge, products, or future sales patterns.

Runtime code: [`src/lib/ai/intelligence/`](../../src/lib/ai/intelligence/).

## Documents

1. [Current architecture audit](./01-architecture-audit.md)
2. [Target AI intelligence architecture](./02-target-architecture.md)
3. [Tenant isolation model](./03-tenant-isolation.md)
4. [Domain model](./04-domain-model.md)
5. [Data ownership matrix](./05-data-ownership.md)
6. [Data flow](./06-data-flow.md)
7. [Future self-learning flow](./07-future-learning-flow.md)
8. [Background processing](./08-background-processing.md)
9. [Retrieval boundary](./09-retrieval-boundary.md)
10. [RLS strategy](./10-rls-strategy.md)
11. [Failure isolation](./11-failure-isolation.md)
12. [Versioning and auditability](./12-versioning-audit.md)
13. [Phase roadmap](./13-phase-roadmap.md)
14. [Risks](./14-risks.md)
15. [Migration plan](./15-migration-plan.md)
16. [Business Knowledge Intelligence (Phase 2)](./16-business-knowledge.md)
17. [Conversation Intelligence (Phase 3)](./17-conversation-intelligence.md)
18. [Tenant Sales Patterns (Phase 4)](./18-sales-patterns.md)
19. [Tenant Sales Pattern Retrieval (Phase 5)](./19-sales-pattern-retrieval.md)
20. [Sales Pattern Effectiveness (Phase 6)](./20-pattern-effectiveness.md)
