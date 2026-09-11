-- Post-migration assertions for the CI job in
-- `.github/workflows/migrations.yml`.
--
-- `supabase db reset` already fails on any statement Postgres rejects,
-- so this is not about syntax. It's about the quieter failure: a
-- migration that applies cleanly and does nothing. Every DDL statement
-- in this repo is guarded with IF NOT EXISTS / ON CONFLICT so the files
-- can be re-run safely, and that same guard turns a typo'd object name
-- into a silent no-op with a green checkmark.
--
-- Keep this thin. It is a smoke test for "did the migrations actually
-- build the schema", not a spec of it — asserting every column here
-- would just be the migrations restated in a second place, drifting.
DO $$
BEGIN
  -- The core tables, from 001.
  IF to_regclass('public.messages') IS NULL THEN
    RAISE EXCEPTION 'public.messages is missing — migrations did not apply';
  END IF;
  IF to_regclass('public.whatsapp_config') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_config is missing — migrations did not apply';
  END IF;

  -- Supabase provides the storage schema; migrations 016/020/023 write
  -- to it. If it is absent the bucket migrations silently accomplish
  -- nothing, which is precisely the case a plain "no errors" run hides.
  IF to_regclass('storage.buckets') IS NULL THEN
    RAISE EXCEPTION
      'storage.buckets is missing — the storage schema was not available when the bucket migrations ran';
  END IF;

  -- Buckets are UPSERTed, so their absence means the INSERT never ran.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'chat-media') THEN
    RAISE EXCEPTION 'the chat-media bucket row was not created (migration 023)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'flow-media') THEN
    RAISE EXCEPTION 'the flow-media bucket row was not created (migration 016)';
  END IF;

  -- Account scoping (017) is load-bearing for every RLS policy.
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE EXCEPTION 'public.accounts is missing — migration 017 did not apply';
  END IF;

  IF to_regclass('public.whatsapp_commerce_orders') IS NULL THEN
    RAISE EXCEPTION 'public.whatsapp_commerce_orders is missing — migration 064 did not apply';
  END IF;

  IF to_regclass('public.catalog_product_events') IS NULL THEN
    RAISE EXCEPTION 'public.catalog_product_events is missing — migration 079 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_collections'
      AND column_name = 'meta_product_set_id'
  ) THEN
    RAISE EXCEPTION 'catalog_collections.meta_product_set_id is missing — migration 080 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'catalog_collections'
      AND column_name = 'meta_collection_review'
  ) THEN
    RAISE EXCEPTION 'catalog_collections.meta_collection_review is missing — migration 084 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name = 'follow_up_delay_minutes'
  ) THEN
    RAISE EXCEPTION 'ai_configs.follow_up_delay_minutes is missing — migration 085 did not apply';
  END IF;

  IF to_regclass('public.conversation_follow_ups') IS NULL THEN
    RAISE EXCEPTION 'public.conversation_follow_ups is missing — migration 085 did not apply';
  END IF;

  IF to_regclass('public.google_sheets_configs') IS NULL THEN
    RAISE EXCEPTION 'public.google_sheets_configs is missing — migration 089 did not apply';
  END IF;

  IF to_regclass('public.platform_google_settings') IS NULL THEN
    RAISE EXCEPTION 'public.platform_google_settings is missing — migration 090 did not apply';
  END IF;

  IF to_regclass('public.sales_events') IS NULL THEN
    RAISE EXCEPTION 'public.sales_events is missing — migration 092 did not apply';
  END IF;

  IF to_regclass('public.conversation_analysis_cursors') IS NULL THEN
    RAISE EXCEPTION 'public.conversation_analysis_cursors is missing — migration 092 did not apply';
  END IF;

  IF to_regclass('public.sales_patterns') IS NULL THEN
    RAISE EXCEPTION 'public.sales_patterns is missing — migration 093 did not apply';
  END IF;

  IF to_regclass('public.pattern_discovery_cursors') IS NULL THEN
    RAISE EXCEPTION 'public.pattern_discovery_cursors is missing — migration 093 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name = 'sales_pattern_retrieval'
  ) THEN
    RAISE EXCEPTION 'ai_configs.sales_pattern_retrieval is missing — migration 094 did not apply';
  END IF;

  IF to_regclass('public.sales_pattern_usages') IS NULL THEN
    RAISE EXCEPTION 'public.sales_pattern_usages is missing — migration 095 did not apply';
  END IF;

  IF to_regclass('public.pattern_effectiveness_cursors') IS NULL THEN
    RAISE EXCEPTION 'public.pattern_effectiveness_cursors is missing — migration 095 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_patterns'
      AND column_name = 'retrieval_eligible'
  ) THEN
    RAISE EXCEPTION 'sales_patterns.retrieval_eligible is missing — migration 095 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_patterns'
      AND column_name = 'effectiveness'
  ) THEN
    RAISE EXCEPTION 'sales_patterns.effectiveness is missing — migration 095 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales_patterns'
      AND column_name = 'last_effectiveness_at'
  ) THEN
    RAISE EXCEPTION 'sales_patterns.last_effectiveness_at is missing — migration 095 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name = 'sales_pattern_effectiveness'
  ) THEN
    RAISE EXCEPTION 'ai_configs.sales_pattern_effectiveness is missing — migration 095 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name = 'ai_behavior_optimization'
  ) THEN
    RAISE EXCEPTION 'ai_configs.ai_behavior_optimization is missing — migration 096 did not apply';
  END IF;

  IF to_regclass('public.ai_behavior_versions') IS NULL THEN
    RAISE EXCEPTION 'public.ai_behavior_versions is missing — migration 096 did not apply';
  END IF;

  IF to_regclass('public.ai_behavior_experiments') IS NULL THEN
    RAISE EXCEPTION 'public.ai_behavior_experiments is missing — migration 096 did not apply';
  END IF;

  IF to_regclass('public.ai_behavior_assignments') IS NULL THEN
    RAISE EXCEPTION 'public.ai_behavior_assignments is missing — migration 096 did not apply';
  END IF;

  IF to_regclass('public.ai_behavior_optimization_cursors') IS NULL THEN
    RAISE EXCEPTION 'public.ai_behavior_optimization_cursors is missing — migration 096 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_behavior_assignments_attributed_event_id_fkey'
  ) THEN
    RAISE EXCEPTION 'ai_behavior_assignments_attributed_event_id_fkey is missing — migration 097 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'last_customer_message_at'
  ) THEN
    RAISE EXCEPTION 'conversations.last_customer_message_at is missing — migration 098 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'customer_service_expires_at'
  ) THEN
    RAISE EXCEPTION 'conversations.customer_service_expires_at is missing — migration 098 did not apply';
  END IF;

  IF to_regclass('public.sales_pattern_shadow_diagnostics') IS NULL THEN
    RAISE EXCEPTION 'public.sales_pattern_shadow_diagnostics is missing — migration 099 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name = 'background_learning_mode'
  ) THEN
    RAISE EXCEPTION 'ai_configs.background_learning_mode is missing — migration 20260911041537 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'preview_conversation_analysis_backfill'
  ) THEN
    RAISE EXCEPTION 'preview_conversation_analysis_backfill is missing — migration 20260911041537 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'start_conversation_analysis'
  ) THEN
    RAISE EXCEPTION 'start_conversation_analysis is missing — migration 20260911041537 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'complete_conversation_analysis'
  ) THEN
    RAISE EXCEPTION 'complete_conversation_analysis is missing — migration 20260911041537 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'count_sales_events_by_type'
  ) THEN
    RAISE EXCEPTION 'count_sales_events_by_type is missing — migration 20260911041537 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'mark_conversation_analysis_trigger_pending'
  ) THEN
    RAISE EXCEPTION 'mark_conversation_analysis_trigger_pending is missing — migration 20260911041537 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'list_conversations_due_for_analysis'
      AND p.pronargs = 3
  ) THEN
    RAISE EXCEPTION 'list_conversations_due_for_analysis(uuid, integer, integer) is missing — migration 20260911041537 did not apply';
  END IF;

  IF to_regclass('public.catalog_recommendation_stats') IS NULL THEN
    RAISE EXCEPTION 'public.catalog_recommendation_stats is missing — migration 20260911041539 did not apply';
  END IF;

  IF to_regclass('public.recommendation_intelligence_cursors') IS NULL THEN
    RAISE EXCEPTION 'public.recommendation_intelligence_cursors is missing — migration 20260911041539 did not apply';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_configs'
      AND column_name = 'recommendation_intelligence'
  ) THEN
    RAISE EXCEPTION 'ai_configs.recommendation_intelligence is missing — migration 20260911041539 did not apply';
  END IF;

  RAISE NOTICE 'schema verification passed';
END
$$;

-- Two things this file has already been burned by, both verified in CI
-- rather than assumed:
--
-- 1. It must contain EXACTLY ONE statement. `supabase db query --file`
--    sends the whole file as a prepared statement, and a second
--    top-level statement fails with the distinctly unhelpful "cannot
--    insert multiple commands into a prepared statement" (commit
--    f91a6c8). Add assertions INSIDE the DO block above; do not append
--    a second one.
--
-- 2. A RAISE in here really does fail the job. A deliberately false
--    assertion (commit 42c7db0, run 31579334056) surfaced as
--    `failed to execute query: error: ...` and exited 1. This is not a
--    decorative green tick.
