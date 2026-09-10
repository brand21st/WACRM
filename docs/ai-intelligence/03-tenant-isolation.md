# 3. Tenant isolation model

## Identity

| Concept | Key |
|---------|-----|
| Tenant / business | `accounts.id` |
| Member | `profiles.user_id` + `profiles.account_id` + `account_role` |
| Customer | `contacts.id` unique within an account by phone |
| Conversation | unique `(account_id, contact_id)` |
| WhatsApp number | `whatsapp_config.phone_number_id` globally unique → one account |

## Two isolation planes

1. **Member (dashboard / cookie APIs)** — Postgres RLS via
   `is_account_member(account_id[, min_role])`. Viewer can read;
   agent+ writes operational data; admin+ writes settings (including
   KB and AI config).
2. **Service role (webhook, cron, workers, public API)** — RLS is
   bypassed. Every query must include `accountId` from a trusted
   source (job payload, `whatsapp_config`, `api_keys`, or
   `getCurrentAccount()`). Never trust a client-supplied foreign
   `accountId` on dashboard routes.

This service-role plane is the highest-risk surface for future
learning jobs.

## Retrieval rule

Tenant filtering happens at the query/storage boundary:

```
WHERE account_id = p_account_id
```

Never: global semantic search → then `filter(accountId)` in app code.

## Cross-business learning

Forbidden in v1. Fashion Brand A conversations must not improve
Fashion Brand B. A future global/industry feature would be an
explicit new product decision, not an accident of a missing
`account_id`.

## PII

Future sales patterns store IDs and structured signals (category,
`budget_max`, objection, outcome). They must not copy phone, email,
full name, address, or payment details.
