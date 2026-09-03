-- 062_package_call_features.sql
-- Live calling AI stays on calling_enabled.
-- Call recording and team forwarding are separate package flags.
-- WhatsApp inbox is included on every plan.

ALTER TABLE billing_packages
  ADD COLUMN IF NOT EXISTS call_recording_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS call_forwarding_enabled boolean NOT NULL DEFAULT false;

UPDATE billing_packages
SET whatsapp_enabled = true
WHERE whatsapp_enabled IS DISTINCT FROM true;
