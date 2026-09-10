# 7. Future self-learning flow

Desired architecture (Phases 3–6), **not** implemented in Phase 1:

```
Conversation
  → Conversation Analyzer          (async BullMQ job)
  → Structured Sales Events        (IDs + typed payload)
  → Outcome Detection              (purchase, reply, handoff, …)
  → Pattern Extraction
  → Pattern Evaluation             (confidence, evidence count)
  → Tenant Sales Brain
  → Relevant Pattern Retrieval     (always WHERE account_id = …)
  → AI Context Builder
  → LLM
  → Final response
```

## What this is not

```
Conversation → automatically fine-tune model
```

A single chat must never mutate the live model. Learning is
structured signals → evaluated tenant patterns → retrieval.

## Positive vs negative signals

Strongest positive: measurable outcomes (purchase / paid), then
product selected, checkout started, customer continued.

Negative (when detectable, not guessed): rejected product, wrong
variant, human takeover, customer stopped responding, customer
correction.

Do not treat “AI generated a reply” as success.

## Idempotency

The same conversation/event may be processed twice. Future jobs use
`idempotencyKey = ${accountId}:${conversationId}:${triggeringMessageId}`
(or a session watermark). Re-processing must not duplicate events or
double-count pattern evidence.

## Auditability

Every used pattern should be explainable:

> Used because this account had N similar conversations and M
> successful outcomes.

That requires Phase 4 evidence counts — not a Phase 1 table.
