# 12. Versioning and auditability

## Reuse now

| Field | Where |
|-------|-------|
| Provider + model | `ai_usage_log` |
| Token counts | `ai_usage_log` |
| AI vs flow bot | `messages.ai_generated` |
| Account persona text | `ai_configs.system_prompt` (current text, not versioned) |

## Do not add in Phase 1

No experiment platform. No `prompt_version` column. No knowledge
snapshot on every reply.

## Defer to Phase 5 / 7 (additive)

Optional columns on `ai_usage_log` or a small `ai_reply_traces` row:

- `prompt_hash`
- `knowledge_chunk_ids`
- `pattern_ids`
- `pattern_version`

Enough to answer “which model and which tenant patterns influenced
this reply?” without a full feature-flag lab.

## Pattern explainability (Phase 4+)

A pattern row should carry `confidence`, `evidenceCount`,
`outcomeMetrics`, `version`, and `active`. Retrieval should be able
to say:

> Used because this account had N similar conversations and M
> successful outcomes.
