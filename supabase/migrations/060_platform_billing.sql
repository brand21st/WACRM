-- ============================================================
-- 060_platform_billing.sql — packages, subscriptions, webhooks
-- ============================================================

CREATE TABLE IF NOT EXISTS billing_packages (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                          text NOT NULL,
  slug                          text NOT NULL UNIQUE,
  description                   text,
  interval                      text NOT NULL DEFAULT 'month'
                                  CHECK (interval IN ('month', 'year')),
  amount_paise                  integer NOT NULL DEFAULT 0
                                  CHECK (amount_paise >= 0),
  currency                      text NOT NULL DEFAULT 'INR',
  is_active                     boolean NOT NULL DEFAULT true,
  is_free                       boolean NOT NULL DEFAULT false,
  sort_order                    integer NOT NULL DEFAULT 0,
  razorpay_plan_id              text,
  ai_enabled                    boolean NOT NULL DEFAULT false,
  ai_monthly_token_cap          integer
                                  CHECK (ai_monthly_token_cap IS NULL OR ai_monthly_token_cap > 0),
  max_seats                     integer NOT NULL DEFAULT 1
                                  CHECK (max_seats >= 1),
  calling_enabled               boolean NOT NULL DEFAULT false,
  whatsapp_enabled              boolean NOT NULL DEFAULT true,
  whatsapp_monthly_message_cap  integer
                                  CHECK (whatsapp_monthly_message_cap IS NULL OR whatsapp_monthly_message_cap > 0),
  shopify_enabled               boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_packages_free_amount_check
    CHECK (NOT is_free OR amount_paise = 0)
);

CREATE INDEX IF NOT EXISTS idx_billing_packages_active_sort
  ON billing_packages (is_active, sort_order, name);

ALTER TABLE billing_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_packages_select ON billing_packages;
CREATE POLICY billing_packages_select ON billing_packages
  FOR SELECT TO authenticated
  USING (is_active = true);

REVOKE INSERT, UPDATE, DELETE ON TABLE billing_packages FROM anon, authenticated;
GRANT SELECT ON TABLE billing_packages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE billing_packages TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON billing_packages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON billing_packages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

INSERT INTO billing_packages (
  name, slug, description, interval, amount_paise, currency,
  is_active, is_free, sort_order,
  ai_enabled, max_seats, calling_enabled, whatsapp_enabled, shopify_enabled
) VALUES (
  'Free',
  'free',
  'WhatsApp inbox for a small team',
  'month',
  0,
  'INR',
  true,
  true,
  0,
  false,
  2,
  false,
  true,
  false
)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_subscriptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                  uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  package_id                  uuid NOT NULL REFERENCES billing_packages(id) ON DELETE RESTRICT,
  status                      text NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'past_due', 'cancelled', 'expired')),
  source                      text NOT NULL DEFAULT 'comp'
                                CHECK (source IN ('checkout', 'comp')),
  razorpay_subscription_id    text,
  razorpay_customer_id        text,
  current_period_end          timestamptz,
  cancel_at_period_end        boolean NOT NULL DEFAULT false,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_subscriptions_package
  ON account_subscriptions (package_id);
CREATE INDEX IF NOT EXISTS idx_account_subscriptions_status
  ON account_subscriptions (status);

ALTER TABLE account_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_subscriptions_select ON account_subscriptions;
CREATE POLICY account_subscriptions_select ON account_subscriptions
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

REVOKE INSERT, UPDATE, DELETE ON TABLE account_subscriptions FROM anon, authenticated;
GRANT SELECT ON TABLE account_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE account_subscriptions TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON account_subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON account_subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS billing_webhook_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_event_id   text NOT NULL UNIQUE,
  event_type          text NOT NULL,
  payload             jsonb NOT NULL,
  processed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_webhook_events_type
  ON billing_webhook_events (event_type, processed_at DESC);

ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE billing_webhook_events FROM PUBLIC;
REVOKE ALL ON TABLE billing_webhook_events FROM anon, authenticated;
GRANT SELECT, INSERT ON TABLE billing_webhook_events TO service_role;

-- Existing accounts + every new signup get the Free package.
INSERT INTO account_subscriptions (account_id, package_id, status, source)
SELECT a.id, p.id, 'active', 'comp'
FROM accounts a
CROSS JOIN billing_packages p
WHERE p.slug = 'free'
  AND NOT EXISTS (
    SELECT 1 FROM account_subscriptions s WHERE s.account_id = a.id
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
  v_free_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  SELECT id INTO v_free_id FROM public.billing_packages WHERE slug = 'free' LIMIT 1;
  IF v_free_id IS NOT NULL THEN
    INSERT INTO public.account_subscriptions (account_id, package_id, status, source)
    VALUES (v_account_id, v_free_id, 'active', 'comp');
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
