-- ============================================================
-- 075_catalog.sql — first-party WACRM catalog foundation
--
-- New account-scoped catalog_* tables become the future product
-- source of truth. This migration does NOT change
-- shopify_catalog_products, AI search, Meta sync, or commerce.
--
-- Phase 1:
--   1. Create catalog schema + RLS (member SELECT, admin+ write).
--   2. Idempotent backfill from shopify_catalog_products.
--   3. Dual-write from Shopify sync lands in a later TS hook;
--      SQL only copies existing snapshot rows.
--
-- retailer_id matches src/lib/shopify/retailer-id.ts:
--   sku              → trim(sku) or variantId
--   variant_id       → variantId
--   facebook_shopify → shopify_IN_{product}_{variant} or variantId
--
-- RLS policy matrix (every catalog_* table, TO authenticated):
--   SELECT  is_account_member(account_id)
--   INSERT  is_account_member(account_id, 'admin')
--   UPDATE  is_account_member(account_id, 'admin') USING + WITH CHECK
--   DELETE  is_account_member(account_id, 'admin')
-- Service-role (webhooks / sync) bypasses RLS.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ----------------------------------------------------------
-- Helpers that mirror retailerIdForVariant / numericShopifyId
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.catalog_numeric_shopify_id(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := trim(coalesce(raw, ''));
  last_part text;
  slash_count int;
BEGIN
  IF v = '' THEN
    RETURN '';
  END IF;
  slash_count := length(v) - length(replace(v, '/', ''));
  IF slash_count > 0 THEN
    last_part := split_part(v, '/', slash_count + 1);
  ELSE
    last_part := v;
  END IF;
  IF last_part ~ '^\d+$' THEN
    RETURN last_part;
  END IF;
  RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_retailer_id_for_variant(
  p_sku text,
  p_variant_id text,
  p_source text,
  p_product_id text
) RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  sku text := trim(coalesce(p_sku, ''));
  variant_id text := trim(coalesce(p_variant_id, ''));
  source text := coalesce(nullif(trim(p_source), ''), 'sku');
  product_num text;
  variant_num text;
BEGIN
  IF source = 'sku' THEN
    IF sku <> '' THEN
      RETURN sku;
    END IF;
    RETURN variant_id;
  END IF;
  IF source = 'facebook_shopify' THEN
    product_num := public.catalog_numeric_shopify_id(p_product_id);
    variant_num := public.catalog_numeric_shopify_id(variant_id);
    IF product_num <> '' AND variant_num <> '' THEN
      RETURN 'shopify_IN_' || product_num || '_' || variant_num;
    END IF;
    RETURN variant_id;
  END IF;
  RETURN variant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.catalog_numeric_or_null(raw text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text := trim(coalesce(raw, ''));
BEGIN
  IF v ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
    RETURN v::numeric;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_catalog_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------
-- Tables
-- ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS catalog_products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle        text NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('draft', 'active', 'archived')),
  brand         text,
  product_url   text,
  currency      text,
  price_min     numeric,
  price_max     numeric,
  origin        text NOT NULL DEFAULT 'wacrm'
                  CHECK (origin IN ('shopify_import', 'wacrm')),
  locked        boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  fts           tsvector GENERATED ALWAYS AS (
                  to_tsvector(
                    'simple',
                    coalesce(title, '') || ' ' || coalesce(description, '')
                  )
                ) STORED,
  UNIQUE (account_id, handle)
);

CREATE INDEX IF NOT EXISTS catalog_products_account_status_idx
  ON catalog_products (account_id, status);

CREATE INDEX IF NOT EXISTS catalog_products_account_published_idx
  ON catalog_products (account_id, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS catalog_products_fts_idx
  ON catalog_products USING gin (fts);

DROP TRIGGER IF EXISTS catalog_products_updated_at ON catalog_products;
CREATE TRIGGER catalog_products_updated_at
  BEFORE UPDATE ON catalog_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_updated_at();

CREATE TABLE IF NOT EXISTS catalog_variants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  title               text NOT NULL DEFAULT 'Default',
  sku                 text,
  price               numeric,
  compare_at_price    numeric,
  currency            text,
  available           boolean NOT NULL DEFAULT true,
  inventory_quantity  integer,
  options             jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order          integer NOT NULL DEFAULT 0,
  retailer_id         text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, retailer_id)
);

CREATE INDEX IF NOT EXISTS catalog_variants_account_product_idx
  ON catalog_variants (account_id, product_id);

CREATE INDEX IF NOT EXISTS catalog_variants_account_sku_idx
  ON catalog_variants (account_id, sku)
  WHERE sku IS NOT NULL;

DROP TRIGGER IF EXISTS catalog_variants_updated_at ON catalog_variants;
CREATE TRIGGER catalog_variants_updated_at
  BEFORE UPDATE ON catalog_variants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_updated_at();

CREATE TABLE IF NOT EXISTS catalog_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  url         text NOT NULL,
  alt         text,
  role        text NOT NULL DEFAULT 'listing'
                CHECK (role IN ('hero', 'listing', 'other')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, url)
);

CREATE INDEX IF NOT EXISTS catalog_media_account_product_idx
  ON catalog_media (account_id, product_id);

CREATE TABLE IF NOT EXISTS catalog_collections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  handle      text NOT NULL,
  title       text NOT NULL,
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('draft', 'active', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, handle)
);

DROP TRIGGER IF EXISTS catalog_collections_updated_at ON catalog_collections;
CREATE TRIGGER catalog_collections_updated_at
  BEFORE UPDATE ON catalog_collections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_updated_at();

CREATE TABLE IF NOT EXISTS catalog_product_collections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  collection_id  uuid NOT NULL REFERENCES catalog_collections(id) ON DELETE CASCADE,
  sort_order     integer NOT NULL DEFAULT 0,
  UNIQUE (product_id, collection_id)
);

CREATE TABLE IF NOT EXISTS catalog_attributes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key         text NOT NULL,
  label       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, key)
);

CREATE TABLE IF NOT EXISTS catalog_attribute_values (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id    uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  variant_id    uuid REFERENCES catalog_variants(id) ON DELETE CASCADE,
  attribute_id  uuid NOT NULL REFERENCES catalog_attributes(id) ON DELETE CASCADE,
  value         text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS catalog_attribute_values_variant_attr_idx
  ON catalog_attribute_values (variant_id, attribute_id)
  WHERE variant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_attribute_values_product_attr_idx
  ON catalog_attribute_values (product_id, attribute_id)
  WHERE variant_id IS NULL;

CREATE TABLE IF NOT EXISTS catalog_product_relations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id          uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  related_product_id  uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  kind                text NOT NULL
                        CHECK (kind IN ('upsell', 'cross_sell', 'bundle', 'similar')),
  sort_order          integer NOT NULL DEFAULT 0,
  UNIQUE (product_id, related_product_id, kind)
);

CREATE TABLE IF NOT EXISTS catalog_external_ids (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  variant_id   uuid REFERENCES catalog_variants(id) ON DELETE CASCADE,
  source       text NOT NULL,
  entity       text NOT NULL CHECK (entity IN ('product', 'variant')),
  external_id  text NOT NULL,
  UNIQUE (account_id, source, entity, external_id)
);

CREATE INDEX IF NOT EXISTS catalog_external_ids_product_idx
  ON catalog_external_ids (account_id, product_id);

CREATE TABLE IF NOT EXISTS catalog_sync_outbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id   uuid REFERENCES catalog_products(id) ON DELETE CASCADE,
  op           text NOT NULL CHECK (op IN ('upsert', 'delete')),
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'succeeded', 'failed')),
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_sync_outbox_pending_idx
  ON catalog_sync_outbox (account_id, status, created_at)
  WHERE status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS catalog_sync_state (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel         text NOT NULL DEFAULT 'meta',
  last_synced_at  timestamptz,
  item_count      integer NOT NULL DEFAULT 0,
  last_error      text,
  UNIQUE (account_id, channel)
);

-- ----------------------------------------------------------
-- RLS + grants
-- ----------------------------------------------------------

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalog_products',
    'catalog_variants',
    'catalog_media',
    'catalog_collections',
    'catalog_product_collections',
    'catalog_attributes',
    'catalog_attribute_values',
    'catalog_product_relations',
    'catalog_external_ids',
    'catalog_sync_outbox',
    'catalog_sync_state'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_select', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (is_account_member(account_id))',
      t || '_select', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (is_account_member(account_id, ''admin''))',
      t || '_insert', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (is_account_member(account_id, ''admin'')) WITH CHECK (is_account_member(account_id, ''admin''))',
      t || '_update', t
    );

    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_delete', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE TO authenticated USING (is_account_member(account_id, ''admin''))',
      t || '_delete', t
    );

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO authenticated, service_role',
      t
    );
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.catalog_numeric_shopify_id(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.catalog_retailer_id_for_variant(text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.catalog_numeric_or_null(text) TO authenticated, service_role;

-- ----------------------------------------------------------
-- Idempotent backfill from shopify_catalog_products
-- Never updates or deletes origin='wacrm' / locked rows.
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.backfill_catalog_from_shopify_snapshot()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  snap record;
  src text;
  product_uuid uuid;
  existing_origin text;
  existing_locked boolean;
  variant jsonb;
  variant_sort int;
  variant_uuid uuid;
  variant_id text;
  variant_gid text;
  retailer text;
  attr_name text;
  attr_value text;
  attr_key text;
  attr_uuid uuid;
  numeric_product text;
  opt jsonb;
BEGIN
  FOR snap IN
    SELECT p.*,
           coalesce(nullif(trim(c.retailer_id_source), ''), 'sku') AS retailer_id_source
    FROM shopify_catalog_products p
    LEFT JOIN shopify_configs c ON c.account_id = p.account_id
  LOOP
    src := snap.retailer_id_source;
    product_uuid := NULL;
    existing_origin := NULL;
    existing_locked := false;

    SELECT e.product_id, cp.origin, cp.locked
      INTO product_uuid, existing_origin, existing_locked
    FROM catalog_external_ids e
    JOIN catalog_products cp ON cp.id = e.product_id
    WHERE e.account_id = snap.account_id
      AND e.source = 'shopify'
      AND e.entity = 'product'
      AND e.external_id = snap.shopify_product_id
    LIMIT 1;

    IF product_uuid IS NULL THEN
      SELECT id, origin, locked
        INTO product_uuid, existing_origin, existing_locked
      FROM catalog_products
      WHERE account_id = snap.account_id
        AND handle = snap.handle
      LIMIT 1;
    END IF;

    IF product_uuid IS NOT NULL AND (existing_origin = 'wacrm' OR existing_locked) THEN
      CONTINUE;
    END IF;

    IF product_uuid IS NULL THEN
      INSERT INTO catalog_products (
        account_id, handle, title, description, status, product_url,
        currency, price_min, price_max, origin, locked, published_at
      ) VALUES (
        snap.account_id,
        snap.handle,
        snap.title,
        coalesce(snap.body, snap.body_excerpt, ''),
        'active',
        snap.product_url,
        snap.currency,
        snap.price_min,
        snap.price_max,
        'shopify_import',
        false,
        snap.published_at
      )
      ON CONFLICT (account_id, handle) DO UPDATE
        SET title = EXCLUDED.title,
            description = EXCLUDED.description,
            product_url = EXCLUDED.product_url,
            currency = EXCLUDED.currency,
            price_min = EXCLUDED.price_min,
            price_max = EXCLUDED.price_max,
            published_at = EXCLUDED.published_at,
            updated_at = now()
        WHERE catalog_products.origin = 'shopify_import'
          AND catalog_products.locked = false
      RETURNING id INTO product_uuid;

      IF product_uuid IS NULL THEN
        SELECT id, origin, locked
          INTO product_uuid, existing_origin, existing_locked
        FROM catalog_products
        WHERE account_id = snap.account_id
          AND handle = snap.handle;
        IF product_uuid IS NULL OR existing_origin = 'wacrm' OR existing_locked THEN
          CONTINUE;
        END IF;
      END IF;
    ELSE
      UPDATE catalog_products
         SET handle = snap.handle,
             title = snap.title,
             description = coalesce(snap.body, snap.body_excerpt, ''),
             product_url = snap.product_url,
             currency = snap.currency,
             price_min = snap.price_min,
             price_max = snap.price_max,
             published_at = snap.published_at,
             status = 'active',
             origin = 'shopify_import'
       WHERE id = product_uuid
         AND origin = 'shopify_import'
         AND locked = false;
    END IF;

    INSERT INTO catalog_external_ids (
      account_id, product_id, variant_id, source, entity, external_id
    ) VALUES (
      snap.account_id, product_uuid, NULL, 'shopify', 'product', snap.shopify_product_id
    )
    ON CONFLICT (account_id, source, entity, external_id) DO NOTHING;

    numeric_product := public.catalog_numeric_shopify_id(snap.shopify_product_id);
    IF numeric_product <> '' AND numeric_product <> snap.shopify_product_id THEN
      INSERT INTO catalog_external_ids (
        account_id, product_id, variant_id, source, entity, external_id
      ) VALUES (
        snap.account_id, product_uuid, NULL, 'shopify', 'product', numeric_product
      )
      ON CONFLICT (account_id, source, entity, external_id) DO NOTHING;
    END IF;

    IF snap.image_url IS NOT NULL AND trim(snap.image_url) <> '' THEN
      INSERT INTO catalog_media (account_id, product_id, url, role, sort_order)
      VALUES (snap.account_id, product_uuid, snap.image_url, 'hero', 0)
      ON CONFLICT (product_id, url) DO UPDATE
        SET role = 'hero';
    END IF;

    variant_sort := 0;
    IF jsonb_typeof(snap.variant_summary) = 'array' THEN
      FOR variant IN SELECT value FROM jsonb_array_elements(snap.variant_summary)
      LOOP
        variant_id := trim(coalesce(variant->>'variantId', ''));
        IF variant_id = '' THEN
          CONTINUE;
        END IF;
        variant_gid := trim(coalesce(variant->>'id', ''));
        retailer := public.catalog_retailer_id_for_variant(
          variant->>'sku',
          variant_id,
          src,
          snap.shopify_product_id
        );
        IF retailer = '' THEN
          CONTINUE;
        END IF;

        IF EXISTS (
          SELECT 1 FROM catalog_variants
          WHERE account_id = snap.account_id
            AND retailer_id = retailer
            AND product_id <> product_uuid
        ) THEN
          CONTINUE;
        END IF;

        INSERT INTO catalog_variants (
          account_id, product_id, title, sku, price, compare_at_price,
          currency, available, options, sort_order, retailer_id
        ) VALUES (
          snap.account_id,
          product_uuid,
          coalesce(nullif(trim(variant->>'title'), ''), 'Default'),
          nullif(trim(coalesce(variant->>'sku', '')), ''),
          public.catalog_numeric_or_null(variant->>'price'),
          public.catalog_numeric_or_null(variant->>'compareAtPrice'),
          snap.currency,
          coalesce((variant->>'available')::boolean, true),
          coalesce(variant->'options', '[]'::jsonb),
          variant_sort,
          retailer
        )
        ON CONFLICT (account_id, retailer_id) DO UPDATE
          SET title = EXCLUDED.title,
              sku = EXCLUDED.sku,
              price = EXCLUDED.price,
              compare_at_price = EXCLUDED.compare_at_price,
              currency = EXCLUDED.currency,
              available = EXCLUDED.available,
              options = EXCLUDED.options,
              sort_order = EXCLUDED.sort_order,
              product_id = EXCLUDED.product_id
          WHERE catalog_variants.product_id = product_uuid
        RETURNING id INTO variant_uuid;

        IF variant_uuid IS NULL THEN
          SELECT id INTO variant_uuid
          FROM catalog_variants
          WHERE account_id = snap.account_id
            AND retailer_id = retailer
            AND product_id = product_uuid;
        END IF;

        IF variant_uuid IS NULL THEN
          variant_sort := variant_sort + 1;
          CONTINUE;
        END IF;

        INSERT INTO catalog_external_ids (
          account_id, product_id, variant_id, source, entity, external_id
        ) VALUES (
          snap.account_id, product_uuid, variant_uuid, 'shopify', 'variant', variant_id
        )
        ON CONFLICT (account_id, source, entity, external_id) DO NOTHING;

        IF variant_gid <> '' AND variant_gid <> variant_id THEN
          INSERT INTO catalog_external_ids (
            account_id, product_id, variant_id, source, entity, external_id
          ) VALUES (
            snap.account_id, product_uuid, variant_uuid, 'shopify', 'variant', variant_gid
          )
          ON CONFLICT (account_id, source, entity, external_id) DO NOTHING;
        END IF;

        IF jsonb_typeof(variant->'options') = 'array' THEN
          FOR opt IN SELECT value FROM jsonb_array_elements(variant->'options')
          LOOP
            attr_name := trim(coalesce(opt->>'name', ''));
            attr_value := trim(coalesce(opt->>'value', ''));
            IF attr_name = '' OR attr_value = '' THEN
              CONTINUE;
            END IF;
            attr_key := lower(attr_name);
            INSERT INTO catalog_attributes (account_id, key, label)
            VALUES (snap.account_id, attr_key, attr_name)
            ON CONFLICT (account_id, key) DO UPDATE
              SET label = EXCLUDED.label
            RETURNING id INTO attr_uuid;

            IF attr_uuid IS NULL THEN
              SELECT id INTO attr_uuid
              FROM catalog_attributes
              WHERE account_id = snap.account_id AND key = attr_key;
            END IF;

            UPDATE catalog_attribute_values
               SET value = attr_value
             WHERE catalog_attribute_values.variant_id = variant_uuid
               AND catalog_attribute_values.attribute_id = attr_uuid;
            IF NOT FOUND THEN
              INSERT INTO catalog_attribute_values (
                account_id, product_id, variant_id, attribute_id, value
              ) VALUES (
                snap.account_id, product_uuid, variant_uuid, attr_uuid, attr_value
              );
            END IF;
          END LOOP;
        END IF;

        variant_sort := variant_sort + 1;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

SELECT public.backfill_catalog_from_shopify_snapshot();
