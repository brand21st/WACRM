# Continuous-learning operations runbook

This runbook covers queue operations only. The public `/api/health` endpoint is
an I/O-free liveness check and must stay that way.

## Topology

The default worker starts every queue:

```text
WORKER_GROUP=all npm run worker
```

For workload isolation, run exactly one `customer` group and one `learning`
group (or scale either group deliberately):

```text
WORKER_GROUP=customer npm run worker
WORKER_GROUP=learning npm run worker
```

`customer` owns chat, voice, recording, knowledge, catalog, and follow-up
queues. `learning` owns conversation analysis, pattern discovery,
recommendation intelligence, effectiveness, and behavior optimization. Do not
run an `all` worker alongside split groups unless the extra consumers are
intentional.

PM2 keeps the existing single-worker topology by default. A split deployment
must define two worker processes with distinct names and set `WORKER_GROUP` on
each. Build `dist/worker.js` before production process changes. This phase does
not deploy or alter any AI production flag.

## Admin operations endpoint

Authenticated account admins can read:

```text
GET /api/ai/intelligence/operations
```

The response is private and non-cacheable. Queue counts and oldest waiting,
active, delayed, and failed ages are deployment-wide operational metadata.
Worker heartbeats include only group, queue names, freshness, and health.
Neither job payloads nor Redis connection details are returned.

`available: false` with `redis_not_configured` means the deployment has no
queue backend. `queue_unavailable` means Redis could not be queried. A
heartbeat older than 45 seconds is unhealthy.

Suggested alerts:

- no healthy heartbeat for a required worker group for 60 seconds;
- oldest waiting age above the queue's customer-facing SLO;
- active age materially above that queue's lock duration;
- failed count increasing across consecutive checks;
- Redis unavailable for more than one check interval.

## Retention and reruns

Completed jobs are retained for at most one hour and 1,000 records per queue.
Failed jobs are retained for at most 14 days and 5,000 records per queue.
These limits preserve a diagnostic window while bounding Redis growth.

Recurring fixed account jobs should use `accountRunJobOptions(accountId,
operation, runId)` when they are enqueued. It creates a unique ID per scheduler
run and a stable BullMQ simple-mode deduplication key per account/operation.
Concurrent duplicate runs collapse while a retained failure cannot block a
later run. The caller must supply a stable run token for retries of the same
scheduler invocation.

Conversation analysis, discovery, recommendation intelligence, effectiveness,
and optimization enqueue paths all use unique run IDs plus short-lived
per-account deduplication. Conversation analysis job IDs are unique `runId`
values; BullMQ also applies a 6-second `accountId:conversationId` replace
dedup so webhook bursts collapse. Operators should not manually delete
failures without preserving incident evidence.

Analyzer worker concurrency is 2.

## Bounded conversation analysis

Account admins can preview, then enqueue, a bounded backfill from AI
Intelligence → Events:

```text
GET  /api/ai/intelligence/analyze-recent
POST /api/ai/intelligence/analyze-recent
```

POST requires the exact confirmation `ANALYZE RECENT CONVERSATIONS`. The
client cannot supply `accountId`. Defaults are a 7-day window and a 10
conversation batch. The hard cap is 100 conversations and 90 days. This is
not “analyze all recent conversations.”

Deterministic mode estimates $0 LLM cost. Hybrid mode estimates tokens from
minimum analyzer pages only. Customer replies stay unchanged.

Do not apply production migrations, enable customer-facing flags, add
Samanga to `AI_INTELLIGENCE_LIVE_APPROVED_ACCOUNTS`, or run a write backfill
from this code milestone. Those are separately approved production steps.

## Safety controls

Continuous learning starts `off` for every account. Account admins can select
`off` or deterministic background analysis and can pause processing from AI
Intelligence settings. Hybrid analysis requires the exact API confirmation
`ENABLE HYBRID LEARNING` because it can consume model tokens.

Recommendation intelligence supports `off` and `shadow` only. Shadow output is
observational and never replaces catalog-safe customer results.

Live pattern retrieval and controlled optimization remain unavailable unless
the account UUID is explicitly listed in the deployment variable
`AI_INTELLIGENCE_LIVE_APPROVED_ACCOUNTS`. Their APIs also require separate
typed confirmations. Do not add Samanga or another production tenant to this
allowlist without an approved canary and rollback owner.

## Incident checks

1. Confirm `/api/health` returns `{"ok":true}` (HTTP process liveness).
2. As an account admin, inspect the operations endpoint.
3. Verify the expected worker group heartbeat is healthy.
4. Compare oldest waiting/active ages with counts and lock durations.
5. Inspect server/worker logs using job IDs. Do not copy job payloads into
   tickets or alerts.
6. Correct Redis or worker process health before retrying jobs.

Graceful shutdown removes the process heartbeat, stops heartbeat writes, and
then closes BullMQ workers. A crash leaves the key to expire automatically.
