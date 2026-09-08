import type { SupabaseClient } from '@supabase/supabase-js'
import { toProductGid } from '@/lib/shopify/map-product'
import {
  findProductIdByExternalId,
  getProductByHandle,
  getProductById,
  getProductByRetailerId,
  getProductBySku,
} from '../core/repository'
import type { CatalogProduct } from '../core/types'
import { attachCatalogFacts } from '../intelligence/facts'

export async function lookupCatalogProduct(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<CatalogProduct | null> {
  const raw = id.trim()
  if (!raw) return null

  const product =
    (await getProductById(db, accountId, raw)) ??
    (await getProductByHandle(db, accountId, raw)) ??
    (await getProductByRetailerId(db, accountId, raw)) ??
    (await getProductBySku(db, accountId, raw)) ??
    (await getProductByShopifyExternalId(db, accountId, raw))

  if (!product) return null
  const [withFacts] = await attachCatalogFacts(db, accountId, [product])
  return withFacts ?? product
}

async function getProductByShopifyExternalId(
  db: SupabaseClient,
  accountId: string,
  raw: string,
): Promise<CatalogProduct | null> {
  const candidates = unique([
    raw,
    raw.startsWith('gid://') ? raw : toProductGid(raw),
  ])
  for (const externalId of candidates) {
    const productId =
      (await findProductIdByExternalId(db, accountId, 'shopify', 'product', externalId)) ??
      (await findProductIdByExternalId(db, accountId, 'shopify', 'variant', externalId))
    if (productId) return getProductById(db, accountId, productId)
  }
  return null
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
