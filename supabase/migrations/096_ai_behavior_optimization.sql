-- ============================================================
-- 096 — Controlled AI behavior optimization (Phase 7)
--
-- Tenant-scoped behavior versions, one control/variant experiment,
-- and conversation-level assignments. Default flag is off.
-- Does not alter sales_events, sales_patterns, or ai_usage_log.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS ai_behavior_optimization text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_ai_behavior_optimization_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_ai_behavior_optimization_check
  CHECK (ai_behavior_optimization IN ('off', 'on'));

COMMENT ON COLUMN ai_configs.ai_behavior_optimization IS
  'Phase 7: off = existing AI behavior; on = allowlisted experiment assignment. Default off.';

CREATE TABLE IF NOT EXISTS ai_behavior_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version                 integer NOT NULL CHECK (version >= 1),
  behavior                jsonb NOT NULL DEFAULT '{}'::jsonb,
  status                  text NOT NULL CHECK (status IN ('draft', 'active', 'archived')),
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_behavior_versions_one_active_idx
  ON ai_behavior_versions (account_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS ai_behavior_versions_account_status_idx
  ON ai_behavior_versions (account_id, status);

ALTER TABLE ai_behavior_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_behavior_versions_select ON ai_behavior_versions;
CREATE POLICY ai_behavior_versions_select ON ai_behavior_versions
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE ai_behavior_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_behavior_versions TO service_role;

COMMENT ON TABLE ai_behavior_versions IS
  'Phase 7 allowlisted behavior versions. No freeform prompts. At most one active per account.';

CREATE TABLE IF NOT EXISTS ai_behavior_experiments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id                  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  objective                   text NOT NULL DEFAULT '',
  control_version_id          uuid NOT NULL REFERENCES ai_behavior_versions(id),
  variant_version_id          uuid NOT NULL REFERENCES ai_behavior_versions(id),
  control_was_implicit        boolean NOT NULL DEFAULT false,
  variant_allocation          integer NOT NULL DEFAULT 50
    CHECK (variant_allocation >= 1 AND variant_allocation <= 99),
  status                      text NOT NULL CHECK (status IN (
    'draft',
    'running',
    'evaluating',
    'approved',
    'rolled_back',
    'archived'
  )),
  started_at                  timestamptz,
  ended_at                    timestamptz,
  evaluation                  jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidate_winner_version_id uuid REFERENCES ai_behavior_versions(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (control_version_id <> variant_version_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_behavior_experiments_one_live_idx
  ON ai_behavior_experiments (account_id)
  WHERE status IN ('running', 'evaluating');

CREATE INDEX IF NOT EXISTS ai_behavior_experiments_account_status_idx
  ON ai_behavior_experiments (account_id, status);

ALTER TABLE ai_behavior_experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_behavior_experiments_select ON ai_behavior_experiments;
CREATE POLICY ai_behavior_experiments_select ON ai_behavior_experiments
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE ai_behavior_experiments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_behavior_experiments TO service_role;

COMMENT ON TABLE ai_behavior_experiments IS
  'Phase 7 tenant experiments. One control and one variant. At most one running/evaluating per account.';

CREATE TABLE IF NOT EXISTS ai_behavior_assignments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  experiment_id           uuid NOT NULL REFERENCES ai_behavior_experiments(id) ON DELETE CASCADE,
  version_id              uuid NOT NULL REFERENCES ai_behavior_versions(id),
  conversation_id         uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  assigned_variant        text NOT NULL CHECK (assigned_variant IN ('control', 'variant')),
  assigned_at             timestamptz NOT NULL,
  attribution_status      text NOT NULL DEFAULT 'unresolved'
    CHECK (attribution_status IN ('unresolved', 'success', 'failure')),
  attributed_event_id     uuid,
  attributed_event_type   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, experiment_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS ai_behavior_assignments_account_assigned_idx
  ON ai_behavior_assignments (account_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS ai_behavior_assignments_account_conversation_idx
  ON ai_behavior_assignments (account_id, conversation_id);

ALTER TABLE ai_behavior_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_behavior_assignments_select ON ai_behavior_assignments;
CREATE POLICY ai_behavior_assignments_select ON ai_behavior_assignments
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE ai_behavior_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_behavior_assignments TO service_role;

COMMENT ON TABLE ai_behavior_assignments IS
  'Phase 7 conversation assignment. One row per account+experiment+conversation. No transcripts or PII.';

CREATE TABLE IF NOT EXISTS ai_behavior_optimization_cursors (
  account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_run_at             timestamptz,
  analyzer_version        text NOT NULL DEFAULT 'v1'
);

ALTER TABLE ai_behavior_optimization_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_behavior_optimization_cursors_select ON ai_behavior_optimization_cursors;
CREATE POLICY ai_behavior_optimization_cursors_select ON ai_behavior_optimization_cursors
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE ai_behavior_optimization_cursors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ai_behavior_optimization_cursors TO service_role;

COMMENT ON TABLE ai_behavior_optimization_cursors IS
  'Per-account watermark for Phase 7 experiment evaluation jobs. Service-role writes only.';

DO $$
BEGIN
  IF to_regclass('public.sales_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'ai_behavior_assignments_attributed_event_id_fkey'
     )
  THEN
    ALTER TABLE ai_behavior_assignments
      ADD CONSTRAINT ai_behavior_assignments_attributed_event_id_fkey
      FOREIGN KEY (attributed_event_id) REFERENCES sales_events(id)
      ON DELETE SET NULL;
  END IF;
END
$$;
