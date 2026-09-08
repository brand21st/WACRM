import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogProduct, CatalogRelationKind } from '../core/types'
import { getCatalogProductsByIds, loadCatalogFacts } from './facts'
import type { CatalogRelationRow } from './types'

export async function listRelatedProducts(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  kinds: CatalogRelationKind[] = ['similar'],
): Promise<CatalogProduct[]> {
  const facts = await loadCatalogFacts(db, accountId, [productId])
  const rows = (facts.relations.get(productId) ?? [])
    .filter((row) => kinds.includes(row.kind))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const relatedIds = rows.map((row) => row.relatedProductId)
  return getCatalogProductsByIds(db, accountId, relatedIds)
}

export async function relatedIdsFor(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  kinds: CatalogRelationKind[],
): Promise<Set<string>> {
  const facts = await loadCatalogFacts(db, accountId, [productId])
  return new Set(
    (facts.relations.get(productId) ?? [])
      .filter((row) => kinds.includes(row.kind))
      .map((row) => row.relatedProductId),
  )
}

export function relationRowsFor(
  relations: Map<string, CatalogRelationRow[]>,
  productId: string,
  kinds: CatalogRelationKind[],
): CatalogRelationRow[] {
  return (relations.get(productId) ?? []).filter((row) => kinds.includes(row.kind))
}
