-- ============================================================
-- 074_ai_product_focus.sql — Agent-selected Shopify product focus
--
-- When an inbox agent replies to a Shopify product card, the thread
-- pins that product so auto-reply / draft only discuss it, collect
-- variants on order intent, and send checkout after Confirm order.
--
-- jsonb on conversations (same pattern as ai_handoff_summary): one
-- focused product per thread, read/written by conversation id.
-- ============================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ai_product_focus jsonb;
