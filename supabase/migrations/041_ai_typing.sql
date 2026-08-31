-- ============================================================
-- 041_ai_typing.sql — WhatsApp typing indicator for AI auto-reply
--
-- Before the assistant generates a reply, Meta can show the customer
-- the WhatsApp "typing…" animation (and mark their inbound as read).
-- The indicator lasts until we send, or 25 seconds, whichever is first.
--
-- `typing_indicator_enabled` is the account toggle (default ON).
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS typing_indicator_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN ai_configs.typing_indicator_enabled IS
  'When true, the auto-reply bot shows WhatsApp typing before it sends.';
