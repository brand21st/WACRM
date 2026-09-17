-- ============================================================
-- 107_meta_messaging.sql
--
-- Instagram + Facebook Messenger as first-class inbox channels.
-- WhatsApp stays the default. Additive only.
--
-- Why this exists:
--   Messenger and Instagram DMs use Page-scoped / Instagram-scoped
--   IDs, not E.164 phones. Contacts were phone-NOT-NULL and unique
--   per (account, phone_normalized), so those identities could not
--   be stored. One Facebook Page per account holds the shared Page
--   access token used by both Messenger and Instagram Messaging.
--
-- Idempotent — safe to re-run.
-- ============================================================

SET search_path TO public, extensions;

-- ------------------------------------------------------------
-- meta_page_connections — one Facebook Page per account
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_page_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  page_name TEXT,
  ig_user_id TEXT,
  ig_username TEXT,
  access_token TEXT NOT NULL,
  verify_token TEXT,
  token_expires_at TIMESTAMPTZ,
  messenger_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (messenger_status IN ('connected', 'disconnected')),
  instagram_status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (instagram_status IN ('connected', 'disconnected')),
  subscribed_apps_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  onboarding_source TEXT NOT NULL DEFAULT 'manual'
    CHECK (onboarding_source IN ('facebook_login', 'manual')),
  last_error TEXT,
  mirror_inbound_media BOOLEAN NOT NULL DEFAULT true,
  meta_app_id TEXT,
  meta_app_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT meta_page_connections_account_id_key UNIQUE (account_id),
  CONSTRAINT meta_page_connections_page_id_key UNIQUE (page_id)
);

CREATE INDEX IF NOT EXISTS idx_meta_page_connections_page_id
  ON meta_page_connections (page_id);

CREATE INDEX IF NOT EXISTS idx_meta_page_connections_ig_user_id
  ON meta_page_connections (ig_user_id)
  WHERE ig_user_id IS NOT NULL;

ALTER TABLE meta_page_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_page_connections_select ON meta_page_connections;
CREATE POLICY meta_page_connections_select ON meta_page_connections
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS meta_page_connections_insert ON meta_page_connections;
CREATE POLICY meta_page_connections_insert ON meta_page_connections
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_page_connections_update ON meta_page_connections;
CREATE POLICY meta_page_connections_update ON meta_page_connections
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS meta_page_connections_delete ON meta_page_connections;
CREATE POLICY meta_page_connections_delete ON meta_page_connections
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON meta_page_connections;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON meta_page_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE meta_page_connections IS
  'One Facebook Page (Messenger + optional Instagram) per account. Token encrypted at rest.';

-- ------------------------------------------------------------
-- contacts: nullable phone + channel identity
-- ------------------------------------------------------------
ALTER TABLE contacts ALTER COLUMN phone DROP NOT NULL;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS channel_user_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contacts_channel_check'
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_channel_check
      CHECK (channel IN ('whatsapp', 'messenger', 'instagram'));
  END IF;
END $$;

UPDATE contacts
SET
  channel = COALESCE(NULLIF(channel, ''), 'whatsapp'),
  channel_user_id = COALESCE(
    NULLIF(channel_user_id, ''),
    NULLIF(phone_normalized, ''),
    id::text
  )
WHERE channel_user_id IS NULL OR channel_user_id = '';

ALTER TABLE contacts ALTER COLUMN channel_user_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_channel_user
  ON contacts (account_id, channel, channel_user_id);

-- Existing inserts that only set phone still get a channel identity.
CREATE OR REPLACE FUNCTION public.contacts_default_channel_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.channel IS NULL OR NEW.channel = '' THEN
    NEW.channel := 'whatsapp';
  END IF;
  IF NEW.channel_user_id IS NULL OR NEW.channel_user_id = '' THEN
    NEW.channel_user_id := COALESCE(
      NULLIF(regexp_replace(COALESCE(NEW.phone, ''), '\D', '', 'g'), ''),
      NEW.id::text
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_default_channel_identity ON contacts;
CREATE TRIGGER contacts_default_channel_identity
  BEFORE INSERT OR UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.contacts_default_channel_identity();

COMMENT ON COLUMN contacts.channel IS
  'whatsapp | messenger | instagram. One CRM identity per channel user id.';
COMMENT ON COLUMN contacts.channel_user_id IS
  'WA: digits-only phone. Messenger: PSID. Instagram: IGSID.';

-- ------------------------------------------------------------
-- conversations.channel (denormalized for inbox filters)
-- ------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_channel_check'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'messenger', 'instagram'));
  END IF;
END $$;

UPDATE conversations c
SET channel = ct.channel
FROM contacts ct
WHERE c.contact_id = ct.id
  AND c.channel IS DISTINCT FROM ct.channel;

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel
  ON conversations (account_id, channel);

CREATE OR REPLACE FUNCTION public.conversations_default_channel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_channel TEXT;
BEGIN
  IF NEW.channel IS NULL OR NEW.channel = '' THEN
    SELECT channel INTO v_channel FROM contacts WHERE id = NEW.contact_id;
    NEW.channel := COALESCE(v_channel, 'whatsapp');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_default_channel ON conversations;
CREATE TRIGGER conversations_default_channel
  BEFORE INSERT ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.conversations_default_channel();
