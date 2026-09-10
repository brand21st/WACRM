# 6. Data flow

## Inbound WhatsApp (today)

```
Meta webhook
  → verify signature
  → whatsapp_config.phone_number_id → accountId
  → findOrCreateContact (account-scoped phone)
  → findOrCreateConversation (account + contact)
  → upsert message (idempotent on conversation_id, message_id)
  → Flows → Automations → AI auto-reply
```

AI auto-reply (inline or `ai-chat-reply` worker) loads only that
account's knowledge, memory, shopping context, and catalog, then
sends a bot message and logs usage.

## Context assembly (today vs Phase 1 composer)

Today: `dispatchInboundToAiReply` calls loaders inline.

Phase 1: `buildAIContext` wraps the same loaders and returns a typed
bag. It is **not** called from auto-reply yet.

```
accountId + contactId + conversationId + message
  → conversation messages
  → contact_ai_memory (+ staff notes)
  → facts.shopping
  → retrieveKnowledge(accountId) + retrieveShopifyStoreContent(accountId)
  → salesPatterns = []
```

## Future analyze path (not built)

After persist (and optionally after the live reply):

```
enqueue ConversationAnalyzeJob { accountId, conversationId, contactId, triggeringMessageId }
  → worker reads messages for that conversation only
  → writes SalesEvent rows (account_id NOT NULL, no raw PII)
```

Live reply never waits on this path.
