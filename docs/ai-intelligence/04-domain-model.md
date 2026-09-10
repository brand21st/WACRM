# 4. Domain model

| Entity | Existing store | Owner | Lifecycle | Source of truth | Read | Write | Future relationship |
|--------|----------------|-------|-----------|-----------------|------|-------|---------------------|
| Tenant / Account | `accounts` | platform + owner | created at signup | `accounts.id` | members of that account; platform admin | owner / platform | Root of every intelligence row |
| User / Member | `auth.users` + `profiles` | account | invite / remove | `profiles.account_id` + role | members (email admin+) | admin+ RPCs | Actor, not tenant |
| Contact | `contacts` | account | created on inbound or API | `(account_id, phone_normalized)` | members | agent+ | Customer memory + events hang off this id |
| Conversation | `conversations` | account | one per contact; open/pending/closed | `(account_id, contact_id)` | members | webhook / inbox | Analyzer input (Phase 3) |
| Message | `messages` | conversation → account | append-only | `messages.id` + Meta `message_id` | members via parent RLS | webhook / send | Raw transcript; events reference ids only |
| Business Knowledge | `ai_knowledge_*`, `shopify_store_content` | account | ingest / scrape / reindex | documents + chunks | members; AI retrieve | admin+ | Phase 2 types categories, same tables |
| Customer Memory | `contact_ai_memory` | account + contact | upsert on summarize / shopping merge | one row per contact | members; AI loaders | memory cron / shopping | Stays customer-specific |
| Catalog / Product | `catalog_*` / Shopify snapshot | account | sync | product + variant ids | members; AI tools | catalog / Shopify sync | Catalog truth in AI context |
| AI Config / Prompt | `ai_configs`, `platform_ai_settings` | account / platform | settings UI | account `system_prompt`; platform model | members / super-admin | admin+ / super-admin | Prompt hash later (Phase 5/7) |
| AI Response | `messages` + `ai_usage_log` | account | one row per send / LLM call | outbound bot message | members | service-role | Trace ids later |
| AI Context | ephemeral | request | built per turn | composer / auto-reply | n/a | n/a | Phase 5 adds pattern slot |
| Sales Event | none (contract only) | account | future derived | structured signal + source message id | — | Phase 3 worker | Feeds patterns |
| Sales Pattern | none (contract only) | account | future derived | tenant-scoped pattern | — | Phase 4 | Retrieved in Phase 5 |
| Outcome | commerce + catalog events + paid timestamps | account | existing writers | existing tables | members | commerce / analytics | Phase 6 scores patterns |

Contracts: `src/lib/ai/intelligence/contracts.ts`.
