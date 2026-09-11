import { getSupabase } from '@/lib/supabase';
import {
  catalogHandleCandidates,
  catalogSkuCandidates,
  normalizeCatalogHandle,
} from '@/lib/parse-catalog-product-card';

type CatalogProductRow = {
  id: string;
  handle: string;
};

type CatalogMediaRow = {
  url: string;
  role: string;
  sort_order: number;
};

function matchCatalogProduct(
  rows: CatalogProductRow[],
  candidates: string[],
): CatalogProductRow | undefined {
  const normalizedCandidates = candidates.map((candidate) => normalizeCatalogHandle(candidate));
  return candidates
    .map((candidate, index) => {
      const normalized = normalizedCandidates[index];
      return rows.find(
        (row) =>
          row.handle === candidate ||
          row.handle.toLowerCase() === candidate.toLowerCase() ||
          normalizeCatalogHandle(row.handle) === normalized,
      );
    })
    .find(Boolean);
}

export async function fetchCatalogProductImage(
  handle: string,
  viewUrl?: string,
): Promise<string | null> {
  const candidates = [
    ...(viewUrl ? catalogHandleCandidates(viewUrl) : []),
    handle,
    normalizeCatalogHandle(handle),
  ].filter(Boolean);
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) return null;

  const supabase = getSupabase();
  const { data: products, error: productError } = await supabase
    .from('catalog_products')
    .select('id, handle')
    .in('handle', uniqueCandidates)
    .eq('status', 'active');
  if (productError) throw productError;

  let productRows = (products ?? []) as CatalogProductRow[];
  let product = matchCatalogProduct(productRows, uniqueCandidates);

  if (!product) {
    const skus = catalogSkuCandidates(handle, viewUrl ?? '');
    for (const sku of skus) {
      const { data: skuMatches, error: skuError } = await supabase
        .from('catalog_products')
        .select('id, handle')
        .eq('status', 'active')
        .ilike('handle', `%${sku}%`)
        .limit(5);
      if (skuError) throw skuError;
      productRows = (skuMatches ?? []) as CatalogProductRow[];
      product = matchCatalogProduct(productRows, uniqueCandidates) ?? productRows[0];
      if (product) break;
    }
  }

  if (!product) return null;

  const { data: media, error: mediaError } = await supabase
    .from('catalog_media')
    .select('url, role, sort_order')
    .eq('product_id', product.id)
    .order('sort_order', { ascending: true });
  if (mediaError) throw mediaError;

  const rows = (media ?? []) as CatalogMediaRow[];
  return rows.find((item) => item.role === 'hero')?.url ?? rows[0]?.url ?? null;
}
