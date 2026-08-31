-- ============================================================
-- 043_auto_reply_unlimited.sql — Optional unlimited auto-replies
--
-- Adds a toggle so accounts can cap bot replies per thread (1–20)
-- or allow unlimited auto-replies. Updates the atomic slot claim
-- so NULL max_replies means no cap.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS auto_reply_unlimited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_configs.auto_reply_unlimited IS
  'When true, auto-replies are not capped per conversation.';

CREATE OR REPLACE FUNCTION public.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean AS $$
  WITH claimed AS (
    UPDATE conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND (max_replies IS NULL OR ai_reply_count < max_replies)
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
