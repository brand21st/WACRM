# 10. RLS strategy

Keep `is_account_member(account_id[, min_role])`. Do not invent a
second tenancy helper.

## Current

- Foundation: `supabase/migrations/017_account_sharing.sql`
- Child tables (`messages`, `automation_steps`, …) join to a parent
  that has `account_id`.
- KB chunks/documents: `is_account_member(account_id)`; admin+ writes.
- `contact_ai_memory`: member SELECT; admin+ write (service-role
  cron bypasses RLS).
- KB search RPCs: `SECURITY INVOKER` (migration 032) so a foreign
  `p_account_id` returns zero rows for members.

## Future intelligence tables (Phase 3+)

Must include:

- `account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE`
- RLS enabled
- SELECT: `is_account_member(account_id)` (viewer+)
- INSERT/UPDATE: service-role and/or admin+
- Indexes starting with `account_id`

## RPCs

Member-callable RPCs: `SECURITY INVOKER`, or `DEFINER` **and**
`is_account_member(p_account_id)` in the body. Follow migration 032,
not the original 030 DEFINER leak.

Service-role RPCs may skip membership checks but must still
`WHERE account_id = p_account_id`.

## Dashboard vs worker

- Dashboard: `getCurrentAccount()` wins. Ignore client-supplied
  foreign account ids.
- Worker: `accountId` comes from the job payload written by a
  trusted server path (webhook already resolved the tenant).
