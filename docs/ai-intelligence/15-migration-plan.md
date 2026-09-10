# 15. Migration plan

## Phase 1

**No Supabase migration.** Existing schema already owns knowledge,
memory, conversations, catalog, and outcomes per account.

## Phase 3

Applied in [`supabase/migrations/092_sales_events.sql`](../../supabase/migrations/092_sales_events.sql):
`sales_events` + `conversation_analysis_cursors`, member SELECT via
`is_account_member`, service-role writes only.

## Phase 4

Applied in [`supabase/migrations/093_sales_patterns.sql`](../../supabase/migrations/093_sales_patterns.sql):
`sales_patterns` + `pattern_discovery_cursors`, member SELECT via
`is_account_member`, service-role writes only.

## Phase 5

Applied in [`supabase/migrations/094_sales_pattern_retrieval.sql`](../../supabase/migrations/094_sales_pattern_retrieval.sql):
`ai_configs.sales_pattern_retrieval`.

## Phase 6

Applied in [`supabase/migrations/095_sales_pattern_effectiveness.sql`](../../supabase/migrations/095_sales_pattern_effectiveness.sql):
`sales_pattern_usages`, `pattern_effectiveness_cursors`,
`sales_patterns.effectiveness` / `retrieval_eligible`,
`ai_configs.sales_pattern_effectiveness`. Does **not** extend
`ai_usage_log`.

## Later (do not apply now)

### Phase 7 — reply metadata (sketch)

Additive columns on `ai_usage_log` or a small traces table:
`prompt_hash`, `knowledge_chunk_ids`, `pattern_version`.

## Compatibility

All later migrations must be additive. Do not break WhatsApp, AI
auto-reply, catalog, Shopify, payments, follow-up, customer memory,
or the existing Knowledge Base.
