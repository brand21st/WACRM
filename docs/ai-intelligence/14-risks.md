# 14. Risks

| Risk | Why it matters | Mitigation |
|------|----------------|------------|
| Service-role query omits `accountId` | Cross-tenant leak; RLS does not apply | Contracts require `accountId`; isolation tests; job payloads always include it |
| Global-then-filter retrieval | Silent tenant leakage at scale | SQL `WHERE account_id = …` first; never global embedding search |
| Mixing layers in one table | Un-debuggable “memory” | Keep KB, customer memory, messages, and future patterns separate |
| Copying raw messages into patterns | PII + huge rows | Structured signals + IDs only |
| Learning on the request path | Slow / failing chat | Async BullMQ after reply |
| Treating every AI reply as success | Bad patterns | Outcomes from purchase / paid first |
| Refactoring `auto-reply.ts` too early | Regression on live WhatsApp | Phase 1 composer is unused by auto-reply |
| Speculative tables now | Migrations to undo | Phase 1 has **no** schema change |
| Cross-brand “helpful” sharing | Brand A learns Brand B | No global pattern table |

## Rollback of Phase 1

Delete `docs/ai-intelligence/`, `src/lib/ai/intelligence/`, and
revert `Conversation.account_id` on the TypeScript type. No data
migration, no worker change, no customer-facing behavior change.
