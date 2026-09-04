-- ============================================================
-- 066_contact_saved_addresses.sql
--
-- Saved delivery addresses per contact, offered back through the
-- native WhatsApp address form's `saved_addresses` parameter so a
-- returning customer picks an address instead of retyping it.
--
-- `form_values` keeps the raw address_message field map exactly as the
-- customer filled it (flat/floor/tower/building are separate fields in
-- WhatsApp but collapse into one line on the bill), so the picker shows
-- their own wording rather than our reconstruction.
--
-- `fingerprint` dedupes: submitting the same address again updates
-- last_used_at instead of stacking duplicates in the picker.
--
-- RLS: members may read; admin+ may write. Webhooks use service-role.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_saved_addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  beneficiary   jsonb NOT NULL,
  form_values   jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint   text NOT NULL,
  last_used_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS contact_saved_addresses_contact_idx
  ON contact_saved_addresses (contact_id, last_used_at DESC);

ALTER TABLE contact_saved_addresses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_saved_addresses_select ON contact_saved_addresses;
CREATE POLICY contact_saved_addresses_select ON contact_saved_addresses FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_saved_addresses_insert ON contact_saved_addresses;
CREATE POLICY contact_saved_addresses_insert ON contact_saved_addresses FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_saved_addresses_update ON contact_saved_addresses;
CREATE POLICY contact_saved_addresses_update ON contact_saved_addresses FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_saved_addresses_delete ON contact_saved_addresses;
CREATE POLICY contact_saved_addresses_delete ON contact_saved_addresses FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_contact_saved_addresses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contact_saved_addresses_updated_at ON contact_saved_addresses;
CREATE TRIGGER contact_saved_addresses_updated_at
  BEFORE UPDATE ON contact_saved_addresses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contact_saved_addresses_updated_at();
