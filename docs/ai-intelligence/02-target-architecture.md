# 2. Target AI intelligence architecture

One Vachat platform. Many isolated business brains. No per-tenant
model deployment.

```
                    VACHAT
                      |
          ---------------------------
          |            |            |
      Tenant A      Tenant B     Tenant C
          |            |            |
     Business KB   Business KB  Business KB
     Customer      Customer     Customer
     Memory        Memory       Memory
     Conversations Conversations Conversations
     Sales Brain   Sales Brain  Sales Brain
```

## Layered context for a reply

When a customer messages Tenant A:

```
Customer message
+ Business knowledge (A)
+ Current customer memory (A + contact)
+ Current conversation (A)
+ Relevant historical sales patterns (A)   ← Phase 5
→ LLM response
```

Tenant B's data is never in that set.

## Conceptual pipeline (future; not implemented)

```
WhatsApp message
  → persist conversation (source of truth)
  → existing live AI response          (synchronous, customer-facing)
  → conversation becomes analyzable    (async)
  → background analyzer                (Phase 3)
  → structured sales events
  → outcome detection                  (Phase 6)
  → pattern extraction / evaluation    (Phase 4)
  → tenant Sales Brain
  → relevant pattern retrieval         (Phase 5)
  → AI context builder
  → LLM
```

A single conversation must never fine-tune the live model.

## Phase 1 boundary

`buildAIContext({ accountId, contactId, conversationId, message })` is
the future orchestration slot. Today it wraps existing loaders and
returns an empty `salesPatterns` array. Live auto-reply is **not**
wired to it yet (`dispatchInboundToAiReply` stays as-is until Phase 5).
