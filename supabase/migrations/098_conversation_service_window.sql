-- ============================================================
-- 098_conversation_service_window
--
-- Canonical WhatsApp customer-service window for mobile (and any
-- other client that should not recompute 24h from a partial
-- message page).
--
--   last_customer_message_at     — UTC start (latest inbound
--                                  customer message).
--   customer_service_expires_at  — last_customer_message_at + 24h.
--                                  NULL when there is no inbound
--                                  customer message yet.
--
-- Postgres rejects GENERATED ALWAYS AS (timestamptz + interval)
-- as not immutable (42P17). A BEFORE trigger keeps the same
-- formula: expires = start + 24 hours.
--
-- The web inbox may still walk messages for the badge this
-- release. The DTO / Realtime row is the source of truth for
-- Expo. Outbound agent/bot sends must NOT move the window —
-- only bump_conversation_on_inbound (webhook) does.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS customer_service_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.conversations.last_customer_message_at IS
  'UTC timestamp of the latest customer (inbound) message. Start of the 24h WhatsApp service window.';

COMMENT ON COLUMN public.conversations.customer_service_expires_at IS
  'last_customer_message_at + 24 hours. NULL when no customer message exists. Maintained by trigger.';

CREATE OR REPLACE FUNCTION public.sync_customer_service_expires_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.last_customer_message_at IS NULL THEN
    NEW.customer_service_expires_at := NULL;
  ELSE
    NEW.customer_service_expires_at := NEW.last_customer_message_at + INTERVAL '24 hours';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_sync_service_window ON public.conversations;
CREATE TRIGGER conversations_sync_service_window
  BEFORE INSERT OR UPDATE OF last_customer_message_at
  ON public.conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_customer_service_expires_at();

-- Backfill from existing inbound messages. Trigger sets expiry.
UPDATE public.conversations c
SET last_customer_message_at = sub.max_at
FROM (
  SELECT conversation_id, MAX(created_at) AS max_at
  FROM public.messages
  WHERE sender_type = 'customer'
  GROUP BY conversation_id
) sub
WHERE c.id = sub.conversation_id
  AND c.last_customer_message_at IS NULL;

-- Same signature as migration 037 so webhook mocks stay valid.
-- Adds last_customer_message_at = NOW() alongside last_message_at.
CREATE OR REPLACE FUNCTION public.bump_conversation_on_inbound(
  p_conversation_id UUID,
  p_last_message_text TEXT
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE conversations
  SET unread_count               = COALESCE(unread_count, 0) + 1,
      last_message_text          = p_last_message_text,
      last_message_at            = NOW(),
      last_customer_message_at   = NOW(),
      updated_at                 = NOW()
  WHERE id = p_conversation_id;
$$;
