# 1. Current architecture audit

## Tenant

- **Identifier:** `accounts.id` (UUID), referenced as `account_id`.
- **No** `tenants` / `organizations` / `workspaces` table.
- **Auth:** Supabase Auth (`auth.users`) + `profiles.account_id` +
  `profiles.account_role` (`owner | admin | agent | viewer`).
- One user belongs to one account. Multiple members can share one
  account via invitations.

### How `accountId` is obtained

| Path | Mechanism | File |
|------|-----------|------|
| Dashboard / cookie APIs | `getCurrentAccount()` / `requireRole()` | `src/lib/auth/account.ts` |
| Client UI | `useAuth().accountId` | `src/hooks/use-auth.tsx` |
| Public API | `api_keys.account_id` | `src/lib/auth/api-context.ts` |
| WhatsApp webhook | `whatsapp_config.phone_number_id` → `account_id` | `src/app/api/whatsapp/webhook/route.ts` |
| Workers | Job payload always includes `accountId` | `src/lib/queue/jobs.ts` |

Member paths are isolated by RLS (`is_account_member`). Service-role
paths (webhook, cron, workers, public API) **bypass RLS** and must
filter by `accountId` in application code.

## Knowledge base

Reuse `ai_knowledge_documents`, `ai_knowledge_chunks`,
`ai_knowledge_scrape_jobs`, and `shopify_store_content`. Retrieval
already starts with `account_id`:

- `retrieveKnowledge(db, accountId, …)` in `src/lib/ai/knowledge.ts`
- RPCs `match_ai_knowledge_semantic(p_account_id, …)` and
  `match_ai_knowledge_fts(p_account_id, …)`
- Catalog RAG is separate: `catalog_product_embeddings` +
  `match_catalog_products_semantic(p_account_id, …)`

Migration `032_fix_ai_knowledge_membership.sql` made the KB RPCs
`SECURITY INVOKER` so member JWTs cannot pass a foreign `p_account_id`.
Documents are unstructured `title + content` (typed categories are
Phase 2, not a second KB).

## Customer memory

Reuse `contact_ai_memory` (one row per contact, `account_id` on every
row) and `conversation_session_summaries`. Shopping context lives in
`facts.shopping` (`src/lib/catalog/intelligence/shopping-context.ts`):
budget, colors, sizes, rejects, stage. `facts.catalogCardQueue` is UI
pagination state mixed into the same jsonb — do not split in Phase 1.

## Conversations and messages

- One conversation per `(account_id, contact_id)` (migration 036).
- Sessions are idle gaps inside that thread, not new rows.
- `messages` have no `account_id`; isolation is via
  `conversations.account_id` + RLS parent join.
- Idempotency: unique `(conversation_id, message_id)` (Meta wamid).
- AI vs flow bot: `sender_type = 'bot'` + `ai_generated`.

Do not copy raw transcripts into a learning table.

## Contacts

Phone (`phone_normalized`) is unique per `(account_id, phone)`. The
same phone can exist in two businesses as two contacts. Memory is
therefore Business A + Customer X, not a global person.

## Background processing

Seven BullMQ queues in `src/lib/queue/names.ts`: `ai-chat-reply`,
`ai-voice-inbound`, `call-recording`, `knowledge-scrape`,
`catalog-meta-sync`, `catalog-embed`, `ai-conversation-follow-up`.
HTTP crons drain automations, flows, broadcasts, Shopify
notifications, voice jobs, chat-memory summarization, follow-ups,
billing, and calling retention.

Phase 1 does **not** add `ai-conversation-analyze`.

## AI context today

There is no live `buildAIContext` call site. `dispatchInboundToAiReply`
(`src/lib/ai/auto-reply.ts`) assembles:

1. `buildConversationContext` (last ~20 messages)
2. `loadContactMemory` + `formatCustomerMemoryBlock`
3. `loadShoppingContext` + `formatSalesSnapshot`
4. `retrieveKnowledge` + `retrieveShopifyStoreContent`
5. Catalog / product focus + Shopify tools
6. `buildSystemPrompt`
7. Generate → send → `logAiUsage`

`ai_usage_log` stores provider, model, and tokens. There is no prompt
version, knowledge chunk list, or pattern id on the reply.

## Outcome signals that already exist

| Signal | Source |
|--------|--------|
| Product shown / search | `catalog_product_events` (`shown`, `search_match`) |
| Add to cart | `catalog_product_events.add_to_cart`; inbound `content_type=order` |
| Checkout started | `whatsapp_commerce_orders.status=pending` |
| Purchase | commerce status; `contacts.wa_commerce_paid_at` / `shopify_paid_at` |
| Checkout abandoned | `shopify_notification_jobs.trigger_key='checkout_abandoned'` |
| Human takeover | `ai_autoreply_disabled`, `assigned_agent_id`, `[[HANDOFF]]` |
| Conversation closed | `conversations.status='closed'` (not a completion event) |

Catalog analytics is opt-in (`ai_configs.catalog_analytics`).
