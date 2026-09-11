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

## Phase 7 (implemented)

Tenant-scoped `ai_behavior_versions` / `ai_behavior_experiments` /
`ai_behavior_assignments`. `ai_usage_log` remains billing telemetry.
See [21-controlled-ai-optimization.md](./21-controlled-ai-optimization.md).

## Pattern explainability (Phase 4+)

A pattern row should carry `confidence`, `evidenceCount`,
`outcomeMetrics`, `version`, and `active`. Retrieval should be able
to say:

> Used because this account had N similar conversations and M
> successful outcomes.
