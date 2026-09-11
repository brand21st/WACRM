-- Continuous-learning controls (Phases 1-2).
-- Defaults are deliberately inert. Service-role workers are the only writers.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS background_learning_mode text NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS background_learning_paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS background_learning_daily_conversation_limit integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS background_learning_daily_token_limit integer NOT NULL DEFAULT 25000;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_background_learning_mode_check,
  ADD CONSTRAINT ai_configs_background_learning_mode_check
    CHECK (background_learning_mode IN ('off', 'deterministic', 'hybrid')),
  DROP CONSTRAINT IF EXISTS ai_configs_background_learning_conversation_limit_check,
  ADD CONSTRAINT ai_configs_background_learning_conversation_limit_check
    CHECK (background_learning_daily_conversation_limit BETWEEN 1 AND 1000),
  DROP CONSTRAINT IF EXISTS ai_configs_background_learning_token_limit_check,
  ADD CONSTRAINT ai_configs_background_learning_token_limit_check
    CHECK (background_learning_daily_token_limit BETWEEN 1000 AND 250000);

ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;
ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
    CHECK (mode IN ('auto_reply', 'draft', 'conversation_analysis')),
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS analyzer_version text;

CREATE INDEX IF NOT EXISTS ai_usage_log_learning_quota_idx
  ON ai_usage_log (account_id, created_at DESC)
  WHERE mode = 'conversation_analysis';

ALTER TABLE conversation_analysis_cursors
  ADD COLUMN IF NOT EXISTS last_source_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_llm_source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_llm_source_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_source_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_trigger jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Existing deterministic progress is also an intentional LLM skip. This
-- prevents a later switch to hybrid from replaying all historical messages.
UPDATE conversation_analysis_cursors
SET last_llm_source_message_id = last_source_message_id,
    last_llm_source_created_at = last_source_created_at
WHERE last_llm_source_message_id IS NULL
  AND last_source_message_id IS NOT NULL;

ALTER TABLE conversation_analysis_cursors
  DROP CONSTRAINT IF EXISTS conversation_analysis_cursors_status_check,
  ADD CONSTRAINT conversation_analysis_cursors_status_check
    CHECK (status IN ('idle', 'pending', 'running', 'failed')),
  DROP CONSTRAINT IF EXISTS conversation_analysis_cursors_pending_trigger_check,
  ADD CONSTRAINT conversation_analysis_cursors_pending_trigger_check CHECK (
    pending_trigger IS NULL OR (
      jsonb_typeof(pending_trigger) = 'object'
      AND COALESCE(pending_trigger->>'type', '') IN ('message', 'commerce')
      AND pending_trigger - ARRAY['type', 'messageId', 'sourceId']::text[] = '{}'::jsonb
      AND (
        (pending_trigger->>'type' = 'message'
          AND jsonb_typeof(pending_trigger->'messageId') = 'string'
          AND pending_trigger->>'messageId' ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
        OR
        (pending_trigger->>'type' = 'commerce'
          AND jsonb_typeof(pending_trigger->'sourceId') = 'string'
          AND pending_trigger->>'sourceId' ~ '^[A-Za-z0-9:_-]{1,200}$')
      )
    )
  ),
  DROP CONSTRAINT IF EXISTS conversation_analysis_cursors_error_code_check,
  ADD CONSTRAINT conversation_analysis_cursors_error_code_check CHECK (
    last_error IS NULL OR last_error IN (
      'analysis_failed',
      'llm_provider_error',
      'llm_invalid_output',
      'llm_config_unavailable',
      'llm_budget_deferred'
    )
  );

CREATE INDEX IF NOT EXISTS conversation_analysis_reconciliation_idx
  ON conversation_analysis_cursors
    (account_id, status, next_attempt_at, updated_at, conversation_id);

CREATE OR REPLACE FUNCTION start_conversation_analysis(
  p_account_id uuid,
  p_conversation_id uuid,
  p_pending_message_id uuid,
  p_pending_trigger jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pending_created_at timestamptz;
BEGIN
  IF p_pending_message_id IS NOT NULL THEN
    SELECT m.created_at INTO v_pending_created_at
    FROM messages m
    JOIN conversations c
      ON c.account_id = p_account_id
     AND c.id = m.conversation_id
    WHERE m.conversation_id = p_conversation_id
      AND m.id = p_pending_message_id;
  END IF;
  v_pending_created_at := COALESCE(v_pending_created_at, now());

  INSERT INTO conversation_analysis_cursors (
    account_id, conversation_id, pending_source_message_id,
    pending_source_created_at, pending_trigger, status, attempt_count, updated_at
  )
  VALUES (
    p_account_id, p_conversation_id, p_pending_message_id,
    v_pending_created_at, p_pending_trigger, 'running', 1, now()
  )
  ON CONFLICT (account_id, conversation_id) DO UPDATE SET
    pending_source_message_id = CASE
      WHEN conversation_analysis_cursors.pending_trigger IS NULL
      THEN EXCLUDED.pending_source_message_id
      ELSE conversation_analysis_cursors.pending_source_message_id
    END,
    pending_source_created_at = CASE
      WHEN conversation_analysis_cursors.pending_trigger IS NULL
      THEN EXCLUDED.pending_source_created_at
      ELSE conversation_analysis_cursors.pending_source_created_at
    END,
    pending_trigger = COALESCE(
      conversation_analysis_cursors.pending_trigger,
      EXCLUDED.pending_trigger
    ),
    status = 'running',
    last_error = NULL,
    attempt_count = conversation_analysis_cursors.attempt_count + 1,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION start_conversation_analysis(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION start_conversation_analysis(uuid, uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION complete_conversation_analysis(
  p_account_id uuid,
  p_conversation_id uuid,
  p_deterministic_message_id uuid,
  p_deterministic_created_at timestamptz,
  p_llm_message_id uuid,
  p_llm_created_at timestamptz,
  p_advance_llm boolean,
  p_retry_llm boolean,
  p_completed_trigger jsonb,
  p_error_code text,
  p_analyzer_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cursor conversation_analysis_cursors%ROWTYPE;
  v_same_trigger boolean;
  v_newer_message boolean;
  v_keep_pending boolean;
BEGIN
  SELECT * INTO v_cursor
  FROM conversation_analysis_cursors
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_same_trigger := COALESCE(v_cursor.pending_trigger = p_completed_trigger, false);
  v_newer_message :=
    v_cursor.pending_source_message_id IS NOT NULL
    AND (
      p_deterministic_message_id IS NULL
      OR p_deterministic_created_at IS NULL
      OR (v_cursor.pending_source_created_at, v_cursor.pending_source_message_id)
         > (p_deterministic_created_at, p_deterministic_message_id)
    );
  -- Trigger acknowledgement and LLM retry state are independent. An exact
  -- commerce trigger clears here even when the lagging LLM watermark retries.
  v_keep_pending := NOT v_same_trigger OR v_newer_message;

  UPDATE conversation_analysis_cursors
  SET last_source_message_id = COALESCE(
        p_deterministic_message_id, last_source_message_id
      ),
      last_source_created_at = COALESCE(
        p_deterministic_created_at, last_source_created_at
      ),
      last_llm_source_message_id = CASE
        WHEN p_advance_llm THEN COALESCE(
          p_llm_message_id, last_llm_source_message_id
        )
        ELSE last_llm_source_message_id
      END,
      last_llm_source_created_at = CASE
        WHEN p_advance_llm THEN COALESCE(
          p_llm_created_at, last_llm_source_created_at
        )
        ELSE last_llm_source_created_at
      END,
      last_analyzed_at = now(),
      analyzer_version = p_analyzer_version,
      status = CASE
        WHEN p_retry_llm AND v_same_trigger AND NOT v_newer_message THEN 'failed'
        WHEN v_keep_pending THEN 'pending'
        ELSE 'idle'
      END,
      pending_source_message_id = CASE
        WHEN v_keep_pending THEN pending_source_message_id
        ELSE NULL
      END,
      pending_source_created_at = CASE
        WHEN v_keep_pending THEN pending_source_created_at
        ELSE NULL
      END,
      pending_trigger = CASE
        WHEN v_keep_pending THEN pending_trigger
        ELSE NULL
      END,
      last_error = CASE
        WHEN p_retry_llm AND v_same_trigger AND NOT v_newer_message
        THEN p_error_code
        ELSE NULL
      END,
      attempt_count = CASE
        WHEN p_retry_llm AND v_same_trigger AND NOT v_newer_message
        THEN attempt_count
        ELSE 0
      END,
      next_attempt_at = CASE
        WHEN p_retry_llm AND v_same_trigger AND NOT v_newer_message
        THEN now() + interval '5 minutes'
        ELSE NULL
      END,
      updated_at = now()
  WHERE account_id = p_account_id
    AND conversation_id = p_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION complete_conversation_analysis(
  uuid, uuid, uuid, timestamptz, uuid, timestamptz,
  boolean, boolean, jsonb, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_conversation_analysis(
  uuid, uuid, uuid, timestamptz, uuid, timestamptz,
  boolean, boolean, jsonb, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION mark_conversation_analysis_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  IF NEW.sender_type <> 'customer'
     OR NOT (
       NEW.content_type IN ('order', 'interactive')
       OR nullif(btrim(NEW.content_text), '') IS NOT NULL
       OR NEW.interactive_reply_id IS NOT NULL
     )
  THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO v_account_id
  FROM conversations
  WHERE id = NEW.conversation_id;

  IF v_account_id IS NULL THEN RETURN NEW; END IF;

  INSERT INTO conversation_analysis_cursors (
    account_id, conversation_id, pending_source_message_id,
    pending_source_created_at, pending_trigger, status, updated_at
  )
  VALUES (
    v_account_id, NEW.conversation_id, NEW.id, NEW.created_at,
    jsonb_build_object('type', 'message', 'messageId', NEW.id),
    'pending', now()
  )
  ON CONFLICT (account_id, conversation_id) DO UPDATE SET
    pending_source_message_id = EXCLUDED.pending_source_message_id,
    pending_source_created_at = EXCLUDED.pending_source_created_at,
    pending_trigger = EXCLUDED.pending_trigger,
    status = CASE
      WHEN conversation_analysis_cursors.status = 'running' THEN 'running'
      ELSE 'pending'
    END,
    next_attempt_at = NULL,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_mark_analysis_pending ON messages;
CREATE TRIGGER messages_mark_analysis_pending
  AFTER INSERT OR UPDATE OF content_text, interactive_reply_id ON messages
  FOR EACH ROW EXECUTE FUNCTION mark_conversation_analysis_pending();

REVOKE ALL ON FUNCTION mark_conversation_analysis_pending()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_conversation_analysis_pending() TO service_role;

CREATE OR REPLACE FUNCTION mark_conversation_analysis_trigger_pending(
  p_account_id uuid,
  p_conversation_id uuid,
  p_trigger jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE account_id = p_account_id AND id = p_conversation_id
  ) THEN
    RETURN;
  END IF;
  INSERT INTO conversation_analysis_cursors (
    account_id, conversation_id, pending_source_created_at,
    pending_trigger, status, updated_at
  )
  VALUES (
    p_account_id, p_conversation_id, now(), p_trigger, 'pending', now()
  )
  ON CONFLICT (account_id, conversation_id) DO UPDATE SET
    pending_source_created_at = EXCLUDED.pending_source_created_at,
    pending_trigger = EXCLUDED.pending_trigger,
    status = CASE
      WHEN conversation_analysis_cursors.status = 'running' THEN 'running'
      ELSE 'pending'
    END,
    next_attempt_at = NULL,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION mark_conversation_analysis_trigger_pending(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_conversation_analysis_trigger_pending(uuid, uuid, jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION list_pending_conversation_analysis(
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  account_id uuid,
  conversation_id uuid,
  contact_id uuid,
  triggering_message_id uuid,
  pending_trigger jsonb
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cursor_row.account_id, cursor_row.conversation_id, c.contact_id,
         COALESCE(
           cursor_row.pending_source_message_id,
           cursor_row.last_source_message_id
         ),
         COALESCE(
           cursor_row.pending_trigger,
           jsonb_build_object(
             'type', 'message',
             'messageId', cursor_row.last_source_message_id
           )
         )
  FROM conversation_analysis_cursors cursor_row
  JOIN conversations c
    ON c.account_id = cursor_row.account_id
   AND c.id = cursor_row.conversation_id
  WHERE cursor_row.status IN ('pending', 'failed')
    AND (
      cursor_row.pending_trigger IS NOT NULL
      OR (
        cursor_row.status = 'failed'
        AND cursor_row.last_source_message_id IS NOT NULL
      )
    )
    AND (cursor_row.next_attempt_at IS NULL OR cursor_row.next_attempt_at <= now())
  ORDER BY cursor_row.updated_at ASC, cursor_row.account_id, cursor_row.conversation_id
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION list_pending_conversation_analysis(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_pending_conversation_analysis(integer)
  TO service_role;

ALTER TABLE pattern_discovery_cursors
  ADD COLUMN IF NOT EXISTS dirty_event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS dirty_event_id uuid REFERENCES sales_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE pattern_discovery_cursors
  DROP CONSTRAINT IF EXISTS pattern_discovery_cursors_status_check,
  ADD CONSTRAINT pattern_discovery_cursors_status_check
    CHECK (status IN ('idle', 'pending', 'running', 'failed'));

CREATE INDEX IF NOT EXISTS pattern_discovery_reconciliation_idx
  ON pattern_discovery_cursors
    (status, next_attempt_at, updated_at, account_id);

CREATE OR REPLACE FUNCTION mark_pattern_discovery_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO pattern_discovery_cursors (
    account_id, dirty_event_created_at, dirty_event_id, status, updated_at
  )
  VALUES (NEW.account_id, NEW.created_at, NEW.id, 'pending', now())
  ON CONFLICT (account_id) DO UPDATE SET
    dirty_event_created_at = CASE
      WHEN pattern_discovery_cursors.dirty_event_created_at IS NULL
        OR (EXCLUDED.dirty_event_created_at, EXCLUDED.dirty_event_id)
         > (pattern_discovery_cursors.dirty_event_created_at,
            pattern_discovery_cursors.dirty_event_id)
      THEN EXCLUDED.dirty_event_created_at
      ELSE pattern_discovery_cursors.dirty_event_created_at
    END,
    dirty_event_id = CASE
      WHEN pattern_discovery_cursors.dirty_event_created_at IS NULL
        OR (EXCLUDED.dirty_event_created_at, EXCLUDED.dirty_event_id)
         > (pattern_discovery_cursors.dirty_event_created_at,
            pattern_discovery_cursors.dirty_event_id)
      THEN EXCLUDED.dirty_event_id
      ELSE pattern_discovery_cursors.dirty_event_id
    END,
    status = 'pending',
    next_attempt_at = NULL,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_events_mark_pattern_dirty ON sales_events;
CREATE TRIGGER sales_events_mark_pattern_dirty
  AFTER INSERT ON sales_events
  FOR EACH ROW EXECUTE FUNCTION mark_pattern_discovery_dirty();

REVOKE ALL ON FUNCTION mark_pattern_discovery_dirty() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_pattern_discovery_dirty() TO service_role;

CREATE OR REPLACE FUNCTION complete_pattern_discovery(
  p_account_id uuid,
  p_processed_created_at timestamptz,
  p_processed_event_id uuid,
  p_analyzer_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pattern_discovery_cursors
  SET last_event_created_at = p_processed_created_at,
      last_run_at = now(),
      analyzer_version = p_analyzer_version,
      status = CASE
        WHEN dirty_event_created_at IS NULL
          OR (dirty_event_created_at, dirty_event_id)
             <= (p_processed_created_at, p_processed_event_id)
        THEN 'idle'
        ELSE 'pending'
      END,
      last_error = NULL,
      attempt_count = 0,
      next_attempt_at = NULL,
      updated_at = now()
  WHERE account_id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION complete_pattern_discovery(uuid, timestamptz, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION complete_pattern_discovery(uuid, timestamptz, uuid, text)
  TO service_role;

CREATE INDEX IF NOT EXISTS sales_events_account_created_idx
  ON sales_events (account_id, created_at DESC);

DROP FUNCTION IF EXISTS list_conversations_due_for_analysis(uuid, integer);

CREATE OR REPLACE FUNCTION list_conversations_due_for_analysis(
  p_account_id uuid,
  p_limit integer DEFAULT 100,
  p_window_days integer DEFAULT 7
)
RETURNS TABLE (
  conversation_id uuid,
  contact_id uuid,
  triggering_message_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.contact_id, latest.id
  FROM conversations c
  LEFT JOIN conversation_analysis_cursors cursor_row
    ON cursor_row.account_id = p_account_id
   AND cursor_row.conversation_id = c.id
  CROSS JOIN LATERAL (
    SELECT m.id, m.created_at
    FROM messages m
    WHERE m.conversation_id = c.id
      AND m.sender_type = 'customer'
      AND (
        m.content_type IN ('order', 'interactive')
        OR nullif(btrim(m.content_text), '') IS NOT NULL
        OR m.interactive_reply_id IS NOT NULL
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 1
  ) latest
  WHERE c.account_id = p_account_id
    AND latest.created_at >= now()
      - (LEAST(GREATEST(COALESCE(p_window_days, 7), 1), 90) * interval '1 day')
    AND (
      cursor_row.conversation_id IS NULL
      OR cursor_row.status IN ('pending', 'failed')
      OR cursor_row.last_source_created_at IS NULL
      OR (latest.created_at, latest.id)
         > (cursor_row.last_source_created_at, cursor_row.last_source_message_id)
    )
    AND (cursor_row.next_attempt_at IS NULL OR cursor_row.next_attempt_at <= now())
  ORDER BY
    COALESCE(cursor_row.updated_at, c.created_at) ASC,
    c.id ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

REVOKE ALL ON FUNCTION list_conversations_due_for_analysis(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION list_conversations_due_for_analysis(uuid, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION preview_conversation_analysis_backfill(
  p_account_id uuid,
  p_window_days integer DEFAULT 7,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  window_days integer,
  max_conversations integer,
  eligible_conversations integer,
  selected_conversations integer,
  eligible_turns bigint,
  minimum_analyzer_pages bigint,
  first_eligible_at timestamptz,
  last_eligible_at timestamptz,
  commerce_order_count integer,
  completed_order_count integer,
  canceled_order_count integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      LEAST(GREATEST(COALESCE(p_window_days, 7), 1), 90) AS window_days,
      LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100) AS max_conversations
  ),
  due AS (
    SELECT
      c.id AS conversation_id,
      latest.created_at,
      COALESCE(cursor_row.updated_at, c.created_at) AS sort_at,
      (
        SELECT count(*)
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sender_type = 'customer'
          AND (
            m.content_type IN ('order', 'interactive')
            OR nullif(btrim(m.content_text), '') IS NOT NULL
            OR m.interactive_reply_id IS NOT NULL
          )
      ) AS eligible_turns
    FROM conversations c
    CROSS JOIN bounds
    LEFT JOIN conversation_analysis_cursors cursor_row
      ON cursor_row.account_id = p_account_id
     AND cursor_row.conversation_id = c.id
    CROSS JOIN LATERAL (
      SELECT m.id, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.sender_type = 'customer'
        AND (
          m.content_type IN ('order', 'interactive')
          OR nullif(btrim(m.content_text), '') IS NOT NULL
          OR m.interactive_reply_id IS NOT NULL
        )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) latest
    WHERE c.account_id = p_account_id
      AND latest.created_at >= now() - (bounds.window_days * interval '1 day')
      AND (
        cursor_row.conversation_id IS NULL
        OR cursor_row.status IN ('pending', 'failed')
        OR cursor_row.last_source_created_at IS NULL
        OR (latest.created_at, latest.id)
           > (cursor_row.last_source_created_at, cursor_row.last_source_message_id)
      )
      AND (cursor_row.next_attempt_at IS NULL OR cursor_row.next_attempt_at <= now())
  ),
  selected AS (
    SELECT due.*
    FROM due
    CROSS JOIN bounds
    ORDER BY due.sort_at ASC, due.conversation_id ASC
    LIMIT (SELECT max_conversations FROM bounds)
  ),
  orders AS (
    SELECT
      count(*)::integer AS commerce_order_count,
      count(*) FILTER (WHERE o.status = 'completed')::integer AS completed_order_count,
      count(*) FILTER (WHERE o.status = 'canceled')::integer AS canceled_order_count
    FROM whatsapp_commerce_orders o
    WHERE o.account_id = p_account_id
  )
  SELECT
    bounds.window_days,
    bounds.max_conversations,
    (SELECT count(*) FROM due)::integer,
    (SELECT count(*) FROM selected)::integer,
    COALESCE((SELECT sum(selected.eligible_turns) FROM selected), 0),
    COALESCE(
      (SELECT sum(ceil(GREATEST(selected.eligible_turns, 1) / 20.0)) FROM selected),
      0
    ),
    (SELECT min(selected.created_at) FROM selected),
    (SELECT max(selected.created_at) FROM selected),
    orders.commerce_order_count,
    orders.completed_order_count,
    orders.canceled_order_count
  FROM bounds
  CROSS JOIN orders;
$$;

REVOKE ALL ON FUNCTION preview_conversation_analysis_backfill(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION preview_conversation_analysis_backfill(uuid, integer, integer)
  TO service_role;

CREATE OR REPLACE FUNCTION count_conversation_analysis_readiness(
  p_account_id uuid
)
RETURNS TABLE (
  analyzed_current integer,
  waiting integer,
  analyzed_today integer,
  last_analyzed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT
      c.id AS conversation_id,
      latest_message.id AS latest_message_id,
      latest_message.created_at AS latest_created_at,
      cursor_row.status,
      cursor_row.last_source_message_id,
      cursor_row.last_source_created_at,
      cursor_row.last_analyzed_at
    FROM conversations c
    LEFT JOIN conversation_analysis_cursors cursor_row
      ON cursor_row.account_id = p_account_id
     AND cursor_row.conversation_id = c.id
    LEFT JOIN LATERAL (
      SELECT m.id, m.created_at
      FROM messages m
      WHERE m.conversation_id = c.id
        AND m.sender_type = 'customer'
        AND (
          m.content_type IN ('order', 'interactive')
          OR nullif(btrim(m.content_text), '') IS NOT NULL
          OR m.interactive_reply_id IS NOT NULL
        )
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT 1
    ) latest_message ON true
    WHERE c.account_id = p_account_id
  )
  SELECT
    count(*) FILTER (
      WHERE latest.latest_message_id IS NOT NULL
        AND latest.status = 'idle'
        AND latest.last_source_created_at IS NOT NULL
        AND (latest.latest_created_at, latest.latest_message_id)
            <= (latest.last_source_created_at, latest.last_source_message_id)
    )::integer,
    count(*) FILTER (
      WHERE latest.latest_message_id IS NOT NULL
        AND NOT (
          latest.status = 'idle'
          AND latest.last_source_created_at IS NOT NULL
          AND (latest.latest_created_at, latest.latest_message_id)
              <= (latest.last_source_created_at, latest.last_source_message_id)
        )
    )::integer,
    count(*) FILTER (
      WHERE latest.last_analyzed_at >= date_trunc('day', timezone('utc', now()))
    )::integer,
    max(latest.last_analyzed_at)
  FROM latest;
$$;

REVOKE ALL ON FUNCTION count_conversation_analysis_readiness(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION count_conversation_analysis_readiness(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION count_sales_events_by_type(
  p_account_id uuid,
  p_since timestamptz
)
RETURNS TABLE (
  event_type text,
  kind text,
  event_count bigint,
  first_created_at timestamptz,
  last_created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    sales_events.event_type,
    sales_events.kind,
    count(*) AS event_count,
    min(sales_events.created_at) AS first_created_at,
    max(sales_events.created_at) AS last_created_at
  FROM sales_events
  WHERE sales_events.account_id = p_account_id
    AND (p_since IS NULL OR sales_events.created_at >= p_since)
  GROUP BY sales_events.event_type, sales_events.kind
  ORDER BY event_count DESC, sales_events.event_type, sales_events.kind;
$$;

REVOKE ALL ON FUNCTION count_sales_events_by_type(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION count_sales_events_by_type(uuid, timestamptz)
  TO service_role;

-- Shadow pattern observations run in the retryable conversation worker. Keep
-- their opaque source-turn identity tenant-scoped and collapse worker retries,
-- including the explicit no-match row where pattern_id is null.
ALTER TABLE sales_pattern_shadow_diagnostics
  ADD COLUMN IF NOT EXISTS source_turn_id uuid;

UPDATE sales_pattern_shadow_diagnostics
SET source_turn_id = turn_id
WHERE source_turn_id IS NULL;

WITH duplicate_diagnostics AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY account_id, source_turn_id, pattern_id
           ORDER BY created_at, id
         ) AS retry_number
  FROM sales_pattern_shadow_diagnostics
)
DELETE FROM sales_pattern_shadow_diagnostics diagnostic
USING duplicate_diagnostics duplicate
WHERE diagnostic.id = duplicate.id
  AND duplicate.retry_number > 1;

ALTER TABLE sales_pattern_shadow_diagnostics
  ALTER COLUMN source_turn_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS sales_pattern_shadow_diagnostics_source_unique,
  ADD CONSTRAINT sales_pattern_shadow_diagnostics_source_unique
    UNIQUE NULLS NOT DISTINCT (account_id, source_turn_id, pattern_id);

GRANT SELECT ON TABLE conversation_analysis_cursors, pattern_discovery_cursors
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE conversation_analysis_cursors, pattern_discovery_cursors
  TO service_role;

COMMENT ON COLUMN ai_configs.background_learning_mode IS
  'Inert by default. deterministic never invokes an LLM; hybrid may use the learning-only structured boundary.';
COMMENT ON COLUMN pattern_discovery_cursors.dirty_event_created_at IS
  'High-water mark set transactionally after a sales_events insert.';
