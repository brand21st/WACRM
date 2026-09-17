-- ============================================================
-- 109_profile_number_id.sql — public numeric user ID
--
-- Settings → Profile currently shows auth.users UUID. That is the
-- internal FK and stays that way. This adds a short sequential
-- number (starting at 1001) for humans: support, screenshots, and
-- the Account details card.
--
-- Identity is attached after backfill so existing rows get IDs in
-- created_at order instead of heap order. GENERATED ALWAYS plus the
-- privilege trigger keep browser clients from rewriting it.
-- Idempotent.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'number_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN number_id bigint;
  END IF;
END $$;

WITH numbered AS (
  SELECT
    id,
    1000 + row_number() OVER (ORDER BY created_at NULLS LAST, id) AS n
  FROM public.profiles
  WHERE number_id IS NULL
)
UPDATE public.profiles p
SET number_id = numbered.n
FROM numbered
WHERE p.id = numbered.id;

ALTER TABLE public.profiles
  ALTER COLUMN number_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_number_id_key'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_number_id_key UNIQUE (number_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'profiles'
      AND a.attname = 'number_id'
      AND a.attidentity <> ''
  ) THEN
    ALTER TABLE public.profiles
      ALTER COLUMN number_id ADD GENERATED ALWAYS AS IDENTITY;
  END IF;
END $$;

SELECT setval(
  pg_get_serial_sequence('public.profiles', 'number_id'),
  GREATEST(COALESCE((SELECT MAX(number_id) FROM public.profiles), 1000), 1000)
);

COMMENT ON COLUMN public.profiles.number_id IS
  'Stable public numeric user ID shown in Settings. Internal FKs stay on user_id UUID.';

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.number_id IS DISTINCT FROM OLD.number_id)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id, and number_id cannot be changed directly; use the account member/invitation RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;
