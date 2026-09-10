# 13. Phase roadmap

| Phase | Goal | Uses existing | Adds |
|-------|------|---------------|------|
| **1** | Multi-tenant foundation | accounts, KB, memory, conversations, BullMQ | Docs, contracts, unused `buildAIContext`, isolation tests |
| **2** | Business knowledge intelligence | `ai_knowledge_*`, store content, catalog | App-level categories, source priority, conflicts, `retrieveBusinessKnowledge` — same tables |
| **3** | Conversation intelligence | `messages`, BullMQ pattern | `ai-conversation-analyze` queue + `sales_events` (account-scoped, no raw PII) |
| **4** | Tenant Sales Brain | Phase 3 events + outcomes | `ai-sales-pattern-discover` + `sales_patterns` (account-scoped, evidence, lifecycle) |
| **5** | Adaptive retrieval | `classifySalesTurn` + `buildSystemPrompt` | `retrieveSalesPatterns` + `sales_pattern_retrieval` (`off`/`shadow`/`on`, default off) |
| **6** (this) | Outcome feedback | injected usages + Phase 3 terminal `sales_events` | `sales_pattern_usages` + observational `retrieval_eligible` |
| **7** | Optimization | `ai_usage_log` | Prompt / model evaluation; still no blind fine-tune |

Invariant through all phases: one platform, many isolated business
brains; live chat never depends on the learning pipeline.
