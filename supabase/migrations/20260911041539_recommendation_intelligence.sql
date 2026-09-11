-- Recommendation intelligence (observational only).
-- Learned ranking is restricted to off|shadow and never changes live output.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS recommendation_intelligence text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_recommendation_intelligence_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_recommendation_intelligence_check
  CHECK (recommendation_intelligence IN ('off', 'shadow'));

ALTER TABLE catalog_recommendation_events
  ADD COLUMN IF NOT EXISTS recommendation_set_id uuid,
  ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_turn_id text,
  ADD COLUMN IF NOT EXISTS rank integer,
  ADD COLUMN IF NOT EXISTS algorithm_version text NOT NULL DEFAULT 'catalog-baseline-v1',
  ADD COLUMN IF NOT EXISTS ranking_variant text NOT NULL DEFAULT 'baseline',
  ADD COLUMN IF NOT EXISTS is_shadow boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_injected boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS baseline_rank integer,
  ADD COLUMN IF NOT EXISTS shadow_rank integer;

-- Existing rows predate set identity. Giving each one its own stable persisted
-- identity avoids inventing relationships during the migration.
UPDATE catalog_recommendation_events
SET recommendation_set_id = id
WHERE recommendation_set_id IS NULL;

ALTER TABLE catalog_recommendation_events
  ALTER COLUMN recommendation_set_id SET NOT NULL;

ALTER TABLE catalog_recommendation_events
  DROP CONSTRAINT IF EXISTS catalog_recommendation_events_event_check;
ALTER TABLE catalog_recommendation_events
  ADD CONSTRAINT catalog_recommendation_events_event_check
  CHECK (event IN (
    'generated',
    'shown',
    'selected',
    'rejected',
    'unresolved'
  ));

ALTER TABLE catalog_recommendation_events
  DROP CONSTRAINT IF EXISTS catalog_recommendation_events_rank_check;
ALTER TABLE catalog_recommendation_events
  ADD CONSTRAINT catalog_recommendation_events_rank_check
  CHECK (
    (rank IS NULL OR rank > 0)
    AND (baseline_rank IS NULL OR baseline_rank > 0)
    AND (shadow_rank IS NULL OR shadow_rank > 0)
  );

ALTER TABLE catalog_recommendation_events
  DROP CONSTRAINT IF EXISTS catalog_recommendation_events_variant_check;
ALTER TABLE catalog_recommendation_events
  ADD CONSTRAINT catalog_recommendation_events_variant_check
  CHECK (ranking_variant IN ('baseline', 'shadow'));

CREATE UNIQUE INDEX IF NOT EXISTS catalog_recommendation_events_account_set_product_event_variant_uidx
  ON catalog_recommendation_events (
    account_id,
    recommendation_set_id,
    product_id,
    event,
    ranking_variant
  );

CREATE INDEX IF NOT EXISTS catalog_recommendation_events_account_set_idx
  ON catalog_recommendation_events (account_id, recommendation_set_id);

CREATE INDEX IF NOT EXISTS catalog_recommendation_events_account_product_created_idx
  ON catalog_recommendation_events (account_id, product_id, created_at DESC)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS catalog_recommendation_events_account_source_message_idx
  ON catalog_recommendation_events (account_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

ALTER TABLE catalog_product_events
  ADD COLUMN IF NOT EXISTS idempotency_key text;

DROP INDEX IF EXISTS catalog_product_events_account_idempotency_uidx;
ALTER TABLE catalog_product_events
  DROP CONSTRAINT IF EXISTS catalog_product_events_account_idempotency_unique,
  ADD CONSTRAINT catalog_product_events_account_idempotency_unique
    UNIQUE (account_id, idempotency_key);

CREATE TABLE IF NOT EXISTS catalog_recommendation_stats (
  account_id                uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id                uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  mode                      text NOT NULL,
  algorithm_version         text NOT NULL,
  generated_count           integer NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  shown_count               integer NOT NULL DEFAULT 0 CHECK (shown_count >= 0),
  selected_count            integer NOT NULL DEFAULT 0 CHECK (selected_count >= 0),
  rejected_count            integer NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  unresolved_count          integer NOT NULL DEFAULT 0 CHECK (unresolved_count >= 0),
  attributed_outcome_count  integer NOT NULL DEFAULT 0 CHECK (attributed_outcome_count >= 0),
  selection_rate            numeric,
  rejection_rate            numeric,
  smoothed_selection_rate   numeric NOT NULL DEFAULT 0.5,
  smoothed_rejection_rate   numeric NOT NULL DEFAULT 0.5,
  baseline_rank_avg         numeric,
  shadow_rank_avg           numeric,
  first_observed_at         timestamptz,
  last_observed_at          timestamptz,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, product_id, mode, algorithm_version),
  CONSTRAINT catalog_recommendation_stats_rate_check CHECK (
    (selection_rate IS NULL OR selection_rate BETWEEN 0 AND 1)
    AND (rejection_rate IS NULL OR rejection_rate BETWEEN 0 AND 1)
    AND smoothed_selection_rate BETWEEN 0 AND 1
    AND smoothed_rejection_rate BETWEEN 0 AND 1
  )
);

CREATE INDEX IF NOT EXISTS catalog_recommendation_stats_account_mode_selection_idx
  ON catalog_recommendation_stats (
    account_id,
    mode,
    smoothed_selection_rate DESC,
    shown_count DESC
  );

CREATE INDEX IF NOT EXISTS catalog_recommendation_stats_account_last_observed_idx
  ON catalog_recommendation_stats (account_id, last_observed_at DESC);

ALTER TABLE catalog_recommendation_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS catalog_recommendation_stats_select
  ON catalog_recommendation_stats;
CREATE POLICY catalog_recommendation_stats_select
  ON catalog_recommendation_stats
  FOR SELECT TO authenticated
  USING ((SELECT is_account_member(account_id)));

CREATE TABLE IF NOT EXISTS recommendation_intelligence_cursors (
  account_id                            uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_recommendation_event_created_at  timestamptz,
  last_recommendation_event_id          uuid,
  last_product_event_created_at         timestamptz,
  last_product_event_id                 uuid,
  pending_recommendation_event_created_at timestamptz,
  pending_recommendation_event_id        uuid,
  pending_product_event_created_at        timestamptz,
  pending_product_event_id                uuid,
  status                                 text NOT NULL DEFAULT 'pending'
                                         CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  attempt_count                          integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at                        timestamptz NOT NULL DEFAULT now(),
  running_started_at                     timestamptz,
  last_error                             text,
  last_run_at                           timestamptz,
  updated_at                            timestamptz NOT NULL DEFAULT now(),
  algorithm_version                     text NOT NULL DEFAULT 'recommendation-intelligence-v1'
);

CREATE INDEX IF NOT EXISTS recommendation_intelligence_cursors_due_idx
  ON recommendation_intelligence_cursors (status, next_attempt_at, updated_at)
  WHERE status IN ('pending', 'failed', 'running');

ALTER TABLE recommendation_intelligence_cursors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS recommendation_intelligence_cursors_select
  ON recommendation_intelligence_cursors;
CREATE POLICY recommendation_intelligence_cursors_select
  ON recommendation_intelligence_cursors
  FOR SELECT TO authenticated
  USING ((SELECT is_account_member(account_id)));

CREATE OR REPLACE FUNCTION mark_recommendation_intelligence_from_recommendation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.recommendation_intelligence_cursors (
    account_id,
    pending_recommendation_event_created_at,
    pending_recommendation_event_id,
    status,
    next_attempt_at,
    updated_at
  )
  VALUES (NEW.account_id, NEW.created_at, NEW.id, 'pending', now(), now())
  ON CONFLICT (account_id) DO UPDATE
  SET pending_recommendation_event_created_at = EXCLUDED.pending_recommendation_event_created_at,
      pending_recommendation_event_id = EXCLUDED.pending_recommendation_event_id,
      status = CASE
        WHEN recommendation_intelligence_cursors.status = 'running' THEN 'running'
        ELSE 'pending'
      END,
      attempt_count = CASE
        WHEN recommendation_intelligence_cursors.status = 'running'
          THEN recommendation_intelligence_cursors.attempt_count
        ELSE 0
      END,
      next_attempt_at = CASE
        WHEN recommendation_intelligence_cursors.status = 'running'
          THEN recommendation_intelligence_cursors.next_attempt_at
        ELSE now()
      END,
      last_error = CASE
        WHEN recommendation_intelligence_cursors.status = 'running'
          THEN recommendation_intelligence_cursors.last_error
        ELSE NULL
      END,
      updated_at = now()
  WHERE recommendation_intelligence_cursors.pending_recommendation_event_created_at IS NULL
     OR (
       recommendation_intelligence_cursors.pending_recommendation_event_created_at,
       recommendation_intelligence_cursors.pending_recommendation_event_id
     ) < (EXCLUDED.pending_recommendation_event_created_at, EXCLUDED.pending_recommendation_event_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION mark_recommendation_intelligence_from_product_outcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.recommendation_intelligence_cursors (
    account_id,
    pending_product_event_created_at,
    pending_product_event_id,
    status,
    next_attempt_at,
    updated_at
  )
  VALUES (NEW.account_id, NEW.created_at, NEW.id, 'pending', now(), now())
  ON CONFLICT (account_id) DO UPDATE
  SET pending_product_event_created_at = EXCLUDED.pending_product_event_created_at,
      pending_product_event_id = EXCLUDED.pending_product_event_id,
      status = CASE
        WHEN recommendation_intelligence_cursors.status = 'running' THEN 'running'
        ELSE 'pending'
      END,
      attempt_count = CASE
        WHEN recommendation_intelligence_cursors.status = 'running'
          THEN recommendation_intelligence_cursors.attempt_count
        ELSE 0
      END,
      next_attempt_at = CASE
        WHEN recommendation_intelligence_cursors.status = 'running'
          THEN recommendation_intelligence_cursors.next_attempt_at
        ELSE now()
      END,
      last_error = CASE
        WHEN recommendation_intelligence_cursors.status = 'running'
          THEN recommendation_intelligence_cursors.last_error
        ELSE NULL
      END,
      updated_at = now()
  WHERE recommendation_intelligence_cursors.pending_product_event_created_at IS NULL
     OR (
       recommendation_intelligence_cursors.pending_product_event_created_at,
       recommendation_intelligence_cursors.pending_product_event_id
     ) < (EXCLUDED.pending_product_event_created_at, EXCLUDED.pending_product_event_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS catalog_recommendation_events_mark_intelligence_dirty
  ON catalog_recommendation_events;
CREATE TRIGGER catalog_recommendation_events_mark_intelligence_dirty
  AFTER INSERT ON catalog_recommendation_events
  FOR EACH ROW
  EXECUTE FUNCTION mark_recommendation_intelligence_from_recommendation_event();

DROP TRIGGER IF EXISTS catalog_product_events_mark_recommendation_intelligence_dirty
  ON catalog_product_events;
CREATE TRIGGER catalog_product_events_mark_recommendation_intelligence_dirty
  AFTER INSERT ON catalog_product_events
  FOR EACH ROW
  WHEN (NEW.event IN ('add_to_cart', 'purchase'))
  EXECUTE FUNCTION mark_recommendation_intelligence_from_product_outcome();

-- Backfill durable dirty state for evidence that predates these triggers.
INSERT INTO recommendation_intelligence_cursors (
  account_id,
  pending_recommendation_event_created_at,
  pending_recommendation_event_id,
  status,
  next_attempt_at,
  updated_at
)
SELECT DISTINCT ON (account_id)
  account_id, created_at, id, 'pending', now(), now()
FROM catalog_recommendation_events
ORDER BY account_id, created_at DESC, id DESC
ON CONFLICT (account_id) DO UPDATE
SET pending_recommendation_event_created_at = EXCLUDED.pending_recommendation_event_created_at,
    pending_recommendation_event_id = EXCLUDED.pending_recommendation_event_id,
    status = 'pending',
    next_attempt_at = now(),
    updated_at = now();

INSERT INTO recommendation_intelligence_cursors (
  account_id,
  pending_product_event_created_at,
  pending_product_event_id,
  status,
  next_attempt_at,
  updated_at
)
SELECT DISTINCT ON (account_id)
  account_id, created_at, id, 'pending', now(), now()
FROM catalog_product_events
WHERE event IN ('add_to_cart', 'purchase')
ORDER BY account_id, created_at DESC, id DESC
ON CONFLICT (account_id) DO UPDATE
SET pending_product_event_created_at = EXCLUDED.pending_product_event_created_at,
    pending_product_event_id = EXCLUDED.pending_product_event_id,
    status = 'pending',
    next_attempt_at = now(),
    updated_at = now();

CREATE OR REPLACE FUNCTION list_due_recommendation_intelligence(p_limit integer DEFAULT 25)
RETURNS TABLE (account_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT cursor_row.account_id
  FROM public.recommendation_intelligence_cursors AS cursor_row
  JOIN public.ai_configs AS config
    ON config.account_id = cursor_row.account_id
   AND config.recommendation_intelligence = 'shadow'
  WHERE (
      cursor_row.status IN ('pending', 'failed')
      OR (
        cursor_row.status = 'running'
        AND cursor_row.running_started_at < now() - interval '15 minutes'
      )
    )
    AND cursor_row.next_attempt_at <= now()
    AND (
      cursor_row.pending_recommendation_event_created_at IS DISTINCT FROM
        cursor_row.last_recommendation_event_created_at
      OR cursor_row.pending_recommendation_event_id IS DISTINCT FROM
        cursor_row.last_recommendation_event_id
      OR cursor_row.pending_product_event_created_at IS DISTINCT FROM
        cursor_row.last_product_event_created_at
      OR cursor_row.pending_product_event_id IS DISTINCT FROM
        cursor_row.last_product_event_id
    )
  ORDER BY cursor_row.next_attempt_at, cursor_row.updated_at, cursor_row.account_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);
$$;

CREATE OR REPLACE FUNCTION claim_recommendation_intelligence(
  p_account_id uuid,
  p_force boolean DEFAULT false
)
RETURNS TABLE (
  pending_recommendation_event_created_at timestamptz,
  pending_recommendation_event_id uuid,
  pending_product_event_created_at timestamptz,
  pending_product_event_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_force THEN
    INSERT INTO public.recommendation_intelligence_cursors (account_id, status)
    VALUES (p_account_id, 'pending')
    ON CONFLICT (account_id) DO NOTHING;
  END IF;

  RETURN QUERY
  UPDATE public.recommendation_intelligence_cursors AS cursor_row
  SET status = 'running',
      attempt_count = cursor_row.attempt_count + 1,
      running_started_at = now(),
      last_run_at = now(),
      updated_at = now()
  WHERE cursor_row.account_id = p_account_id
    AND (
      cursor_row.status <> 'running'
      OR cursor_row.running_started_at < now() - interval '15 minutes'
    )
    AND cursor_row.next_attempt_at <= now()
    AND (
      p_force
      OR cursor_row.pending_recommendation_event_created_at IS DISTINCT FROM
        cursor_row.last_recommendation_event_created_at
      OR cursor_row.pending_recommendation_event_id IS DISTINCT FROM
        cursor_row.last_recommendation_event_id
      OR cursor_row.pending_product_event_created_at IS DISTINCT FROM
        cursor_row.last_product_event_created_at
      OR cursor_row.pending_product_event_id IS DISTINCT FROM
        cursor_row.last_product_event_id
    )
  RETURNING
    cursor_row.pending_recommendation_event_created_at,
    cursor_row.pending_recommendation_event_id,
    cursor_row.pending_product_event_created_at,
    cursor_row.pending_product_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION complete_recommendation_intelligence(
  p_account_id uuid,
  p_recommendation_created_at timestamptz,
  p_recommendation_id uuid,
  p_product_created_at timestamptz,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.recommendation_intelligence_cursors AS cursor_row
  SET last_recommendation_event_created_at = p_recommendation_created_at,
      last_recommendation_event_id = p_recommendation_id,
      last_product_event_created_at = p_product_created_at,
      last_product_event_id = p_product_id,
      status = CASE
        WHEN cursor_row.pending_recommendation_event_created_at IS NOT DISTINCT FROM p_recommendation_created_at
         AND cursor_row.pending_recommendation_event_id IS NOT DISTINCT FROM p_recommendation_id
         AND cursor_row.pending_product_event_created_at IS NOT DISTINCT FROM p_product_created_at
         AND cursor_row.pending_product_event_id IS NOT DISTINCT FROM p_product_id
          THEN 'succeeded'
        ELSE 'pending'
      END,
      attempt_count = 0,
      next_attempt_at = now(),
      running_started_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE cursor_row.account_id = p_account_id
    AND cursor_row.status = 'running';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION fail_recommendation_intelligence(
  p_account_id uuid,
  p_error text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  changed integer;
BEGIN
  UPDATE public.recommendation_intelligence_cursors AS cursor_row
  SET status = 'failed',
      next_attempt_at = now()
        + LEAST(power(2, GREATEST(cursor_row.attempt_count - 1)), 60)
          * interval '1 minute',
      running_started_at = NULL,
      last_error = left(COALESCE(p_error, 'unknown error'), 1000),
      updated_at = now()
  WHERE cursor_row.account_id = p_account_id
    AND cursor_row.status = 'running';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION replace_catalog_recommendation_stats(
  p_account_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  written integer;
BEGIN
  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)) > 20000 THEN
    RAISE EXCEPTION 'recommendation stats payload must be an array of at most 20000 rows';
  END IF;

  DELETE FROM public.catalog_recommendation_stats
  WHERE account_id = p_account_id;

  INSERT INTO public.catalog_recommendation_stats (
    account_id, product_id, mode, algorithm_version,
    generated_count, shown_count, selected_count, rejected_count,
    unresolved_count, attributed_outcome_count,
    selection_rate, rejection_rate,
    smoothed_selection_rate, smoothed_rejection_rate,
    baseline_rank_avg, shadow_rank_avg,
    first_observed_at, last_observed_at, updated_at
  )
  SELECT
    p_account_id, source_row.product_id, source_row.mode, source_row.algorithm_version,
    source_row.generated_count, source_row.shown_count,
    source_row.selected_count, source_row.rejected_count,
    source_row.unresolved_count, source_row.attributed_outcome_count,
    source_row.selection_rate, source_row.rejection_rate,
    source_row.smoothed_selection_rate, source_row.smoothed_rejection_rate,
    source_row.baseline_rank_avg, source_row.shadow_rank_avg,
    source_row.first_observed_at, source_row.last_observed_at, now()
  FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS source_row (
    product_id uuid,
    mode text,
    algorithm_version text,
    generated_count integer,
    shown_count integer,
    selected_count integer,
    rejected_count integer,
    unresolved_count integer,
    attributed_outcome_count integer,
    selection_rate numeric,
    rejection_rate numeric,
    smoothed_selection_rate numeric,
    smoothed_rejection_rate numeric,
    baseline_rank_avg numeric,
    shadow_rank_avg numeric,
    first_observed_at timestamptz,
    last_observed_at timestamptz
  )
  JOIN public.catalog_products AS product
    ON product.id = source_row.product_id
   AND product.account_id = p_account_id;

  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN written;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_recommendation_intelligence_from_recommendation_event()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION mark_recommendation_intelligence_from_product_outcome()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION list_due_recommendation_intelligence(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION claim_recommendation_intelligence(uuid, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION complete_recommendation_intelligence(uuid, timestamptz, uuid, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION fail_recommendation_intelligence(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION replace_catalog_recommendation_stats(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION list_due_recommendation_intelligence(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION claim_recommendation_intelligence(uuid, boolean)
  TO service_role;
GRANT EXECUTE ON FUNCTION complete_recommendation_intelligence(uuid, timestamptz, uuid, timestamptz, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION fail_recommendation_intelligence(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION replace_catalog_recommendation_stats(uuid, jsonb)
  TO service_role;

GRANT SELECT ON TABLE catalog_recommendation_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog_recommendation_events TO service_role;
GRANT SELECT ON TABLE catalog_recommendation_stats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog_recommendation_stats TO service_role;
GRANT SELECT ON TABLE recommendation_intelligence_cursors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recommendation_intelligence_cursors TO service_role;

COMMENT ON COLUMN ai_configs.recommendation_intelligence IS
  'off by default; shadow computes observational learned ranks but cannot inject or reorder customer-facing recommendations.';
COMMENT ON TABLE catalog_recommendation_stats IS
  'Account-leading observational recommendation aggregates. Rates are smoothed correlations, not causal effect estimates.';
COMMENT ON TABLE recommendation_intelligence_cursors IS
  'Service-written watermarks for idempotent recommendation aggregate refresh and rebuild.';
