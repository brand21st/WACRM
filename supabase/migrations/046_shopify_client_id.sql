-- 046_shopify_client_id.sql
-- Custom-app Client ID (API key) shown in Shopify admin. Not a secret;
-- stored plaintext so the Settings panel can display it after save.

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS client_id text;
