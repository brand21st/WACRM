import type { SupabaseClient } from '@supabase/supabase-js'

import { requireAccountId } from './contracts'
import type { SalesEventMetadata } from './sales-event-types'

export type OwnedCatalogRefs = {
  productIds: Set<string>
  variantIds: Set<string>
}

export function applyOwnedCatalogMetadata(
  metadata: SalesEventMetadata,
  owned: OwnedCatalogRefs
): SalesEventMetadata {
  const next: SalesEventMetadata = { ...metadata }
  if (next.productId && !owned.productIds.has(next.productId)) {
    delete next.productId
  }
  if (next.variantId && !owned.variantIds.has(next.variantId)) {
    delete next.variantId
  }
  return next
}

export async function loadOwnedCatalogRefs(
  db: SupabaseClient,
  accountId: string,
  refs: { productIds: string[]; variantIds: string[] }
): Promise<OwnedCatalogRefs> {
  const id = requireAccountId(accountId, 'loadOwnedCatalogRefs')
  const productIds = [...new Set(refs.productIds.filter(Boolean))]
  const variantIds = [...new Set(refs.variantIds.filter(Boolean))]
  const owned: OwnedCatalogRefs = {
    productIds: new Set<string>(),
    variantIds: new Set<string>(),
  }
  if (productIds.length) {
    const { data, error } = await db
      .from('catalog_products')
      .select('id')
      .eq('account_id', id)
      .in('id', productIds)
    if (error) throw error
    for (const row of data ?? []) {
      if (row.id) owned.productIds.add(String(row.id))
    }
  }
  if (variantIds.length) {
    const { data, error } = await db
      .from('catalog_variants')
      .select('id')
      .eq('account_id', id)
      .in('id', variantIds)
    if (error) throw error
    for (const row of data ?? []) {
      if (row.id) owned.variantIds.add(String(row.id))
    }
  }
  return owned
}
