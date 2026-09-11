# 21. Controlled AI optimization (Phase 7)

**Phase 7 is controlled experimentation, not autonomous self-modification.**

**Observed improvement does not establish universal causal truth.**

**Experimental behavior is subordinate to current customer intent, catalog facts, business knowledge, and business policies.**

Phase 7 tests allowlisted AI *behavior* configurations against verified
Phase 3 commerce outcomes. It does not train models, rewrite production
prompts, change prices or policies, or promote a variant without an
admin.

Default flag: `ai_configs.ai_behavior_optimization = off`.

## What it optimizes

Allowlisted JSON only (`injectSalesGuidance`, `replyStyle`, `ctaStyle`).
Semantics live in source (`ai-behavior-prompt.ts`). The database never
stores a freeform system prompt.

There is no `force_on`. If Phase 5 is off, `inherit` cannot inject sales
guidance.

## Precedence

1. Current customer request
2. Catalog / product facts
3. Business knowledge / policies
4. Customer memory
5. Phase 5 sales guidance
6. Phase 7 experimental behavior block
7. Generic model knowledge

## Lifecycle

```
draft → (admin start, flag ON) → running
  → (minimum evidence) → evaluating
  → (admin approve) → approved
```

Rollback is allowed from `running`, `evaluating`, or `approved`.
Start and approve require the flag ON. Rollback is allowed when OFF.

One control, one variant. At most one `running` or `evaluating`
experiment per account.

## Assignment

Stable scope: `conversationId`.

`uint32(SHA256(accountId + ":" + experimentId + ":" + conversationId)) % 100`
compared to `variant_allocation`.

Exposure is the first eligible live auto-reply **LLM** turn (not
factReply, greeting, stay, language picker, draft, playground, live
call, or follow-up). Later messages reuse the same row. LLM retries
reuse the same arm and do not insert a second assignment.

`evaluating` stops **new** assignments. Existing assigned conversations
keep their arm.

## Outcomes

Reuse Phase 6 rules on `sales_events.created_at`:

- Success: `ORDER_CREATED`, `PAYMENT_COMPLETED`
- Failure: `ORDER_CANCELLED`, `CHECKOUT_ABANDONED`
- Funnel-only (`CART_CREATED`, `CHECKOUT_STARTED`) is not conversion
- Unresolved is not failure
- Window: 7 days after `assigned_at`; latest terminal wins
- Sample unit: conversation

`observedSuccessRate = success / (success + failure)`

## Winner

Conservative constants: 40 assignments, 15 eligible outcomes per arm,
5 point absolute lift, 7 running days. Guardrail: variant failure rate
may not exceed control by more than 10 points.

A candidate is **observed improvement** only. Admin approval activates
exactly `candidate_winner_version_id`. Rollback restores exactly
`control_version_id`, or implicit default when `control_was_implicit`.

## Emergency kill switch

Set `ai_behavior_optimization = off`. Existing production behavior
returns immediately. Independently, `sales_pattern_retrieval = off`
disables Phase 5.

Do not delete historical experiments, assignments, `sales_events`,
`sales_patterns`, or usages.

## Privacy

Assignment rows store IDs, variant, timestamps, and attribution
references. No transcripts, phone, email, address, or payment data.

## Relationship to Phase 5 / 6

Phase 4 discovers patterns. Phase 5 retrieves them. Phase 6 measures
pattern effectiveness. Phase 7 does **not** rewrite
`sales_patterns.recommended_behavior`. It only tests how the live model
applies allowlisted style configuration.

## Limitations

No automatic promotion or rollback. No LLM-generated candidates. No
multi-variant overlap. No Bayesian significance. No live dual-response
shadow. No transcript replay. No model/provider experiments. No
cross-tenant winners.
