# 11. Failure isolation strategy

Customer chat must not depend on the future learning pipeline.

| Failure | Customer-facing result |
|---------|------------------------|
| Analyze / learning worker down | Chat continues; no new events/patterns |
| Knowledge indexing / retrieve fails | Empty or lexical excerpts; reply continues |
| Usage / analytics insert fails | Logged and swallowed |
| Pattern retrieval fails (Phase 5) | Omit the pattern block; still reply from KB + memory + catalog |
| Redis unavailable | Existing inline / Postgres fallbacks |

This already matches live code: `retrieveKnowledge` never throws into
auto-reply; `logAiUsage` never throws; catalog analytics warns and
returns.

Phase 1 `buildAIContext` follows the same rule: loader failures
become empty slices, except a missing `accountId`, which is a
programmer error and throws before any query.
