-- 063_clear_account_ai_keys.sql
-- Hosted keys live in platform_ai_settings. Drop leftover merchant copies.

UPDATE ai_configs
SET
  api_key = NULL,
  embeddings_api_key = NULL,
  elevenlabs_api_key = NULL,
  sarvam_api_key = NULL
WHERE api_key IS NOT NULL
   OR embeddings_api_key IS NOT NULL
   OR elevenlabs_api_key IS NOT NULL
   OR sarvam_api_key IS NOT NULL;
