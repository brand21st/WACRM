-- Compact title matching so “washup”, “tshirt”, and “coordset” hit
-- “Wash Up”, “T-Shirt”, and “Coord Set” for every merchant catalog.

ALTER TABLE public.catalog_products
  DROP COLUMN IF EXISTS title_norm;

ALTER TABLE public.catalog_products
  ADD COLUMN title_norm text
  GENERATED ALWAYS AS (
    regexp_replace(lower(coalesce(title, '')), '[^[:alnum:]]+', '', 'g')
  ) STORED;

CREATE INDEX IF NOT EXISTS catalog_products_account_title_norm_idx
  ON public.catalog_products (account_id, title_norm);
