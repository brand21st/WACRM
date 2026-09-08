import type { SupabaseClient } from '@supabase/supabase-js'

export interface CatalogImportCoverage {
  accountId: string
  snapshotCount: number
  importedCount: number
  gap: number
}

/**
 * Compare Shopify snapshot rows to WACRM import rows. Not a runtime
 * search fallback — never overwrite origin='wacrm' / locked products.
 */
export async function assertCatalogImportCoverage(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogImportCoverage> {
  const [{ count: snapshotCount, error: snapErr }, { count: importedCount, error: importErr }] =
    await Promise.all([
      db
        .from('shopify_catalog_products')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId),
      db
        .from('catalog_products')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('origin', 'shopify_import'),
    ])
  if (snapErr) throw snapErr
  if (importErr) throw importErr

  const coverage: CatalogImportCoverage = {
    accountId,
    snapshotCount: snapshotCount ?? 0,
    importedCount: importedCount ?? 0,
    gap: Math.max(0, (snapshotCount ?? 0) - (importedCount ?? 0)),
  }
  if (coverage.gap > 0) {
    console.warn('[catalog-search] import coverage gap', coverage)
  }
  return coverage
}
