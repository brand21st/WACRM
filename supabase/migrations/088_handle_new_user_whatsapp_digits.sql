-- ============================================================
-- Digits-only copy of signup WhatsApp metadata onto profiles.
--
-- 087 used POSIX `\D`, which some apply paths double-escaped into a
-- literal backslash+D pattern. `[^0-9]` is unambiguous.
-- Idempotent — CREATE OR REPLACE only.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_whatsapp TEXT;
  v_account_id UUID;
  v_free_id UUID;
BEGIN
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');
  v_whatsapp := NULLIF(
    regexp_replace(
      COALESCE(NEW.raw_user_meta_data->>'whatsapp_number', ''),
      '[^0-9]',
      '',
      'g'
    ),
    ''
  );

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (
    user_id, full_name, email, account_id, account_role, whatsapp_number
  )
  VALUES (
    NEW.id, v_full_name, NEW.email, v_account_id, 'owner', v_whatsapp
  );

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
