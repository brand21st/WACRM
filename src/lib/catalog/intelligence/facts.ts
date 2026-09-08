import type { SupabaseClient } from '@supabase/supabase-js'
import { hydrateProducts, PRODUCT_SELECT, type ProductRow } from '../core/repository'
import { parseCatalogStatus } from '../core/status'
import type {
  CatalogAttributeValue,
  CatalogCollection,
  CatalogProduct,
  CatalogRelationKind,
} from '../core/types'
import { CATALOG_RELATION_KINDS } from '../core/types'
import type { CatalogRelationRow } from './types'

type AttributeValueRow = {
  id: string
  account_id: string
  product_id: string
  variant_id: string | null
  attribute_id: string
  value: string
}

type AttributeDefRow = {
  id: string
  key: string
  label: string
}

type CollectionRow = {
  id: string
  account_id: string
  handle: string
  title: string
  status: string
}

type ProductCollectionRow = {
  product_id: string
  collection_id: string
}

type RelationRow = {
  product_id: string
  related_product_id: string
  kind: string
  sort_order: number
}

export function logCatalogIntel(args: {
  accountId: string
  tool: string
  count: number
  extra?: Record<string, unknown>
}): void {
  console.info('[catalog-intel]', {
    accountId: args.accountId,
    tool: args.tool,
    count: args.count,
    ...(args.count === 0 ? { empty: true } : {}),
    ...args.extra,
  })
}

export async function attachCatalogFacts(
  db: SupabaseClient,
  accountId: string,
  products: CatalogProduct[],
): Promise<CatalogProduct[]> {
  if (products.length === 0) return products
  const facts = await loadCatalogFacts(
    db,
    accountId,
    products.map((product) => product.id),
  )
  return products.map((product) => ({
    ...product,
    collections: facts.collections.get(product.id) ?? product.collections ?? [],
    attributes: facts.attributes.get(product.id) ?? product.attributes ?? [],
  }))
}

export async function loadCatalogFacts(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<{
  collections: Map<string, CatalogCollection[]>
  attributes: Map<string, CatalogAttributeValue[]>
  relations: Map<string, CatalogRelationRow[]>
}> {
  const ids = unique(productIds)
  const empty = {
    collections: new Map<string, CatalogCollection[]>(),
    attributes: new Map<string, CatalogAttributeValue[]>(),
    relations: new Map<string, CatalogRelationRow[]>(),
  }
  if (ids.length === 0) return empty

  const [collectionLinks, valueRows, relationRows] = await Promise.all([
    loadRows<ProductCollectionRow>(
      db
        .from('catalog_product_collections')
        .select('product_id, collection_id')
        .eq('account_id', accountId)
        .in('product_id', ids),
    ),
    loadRows<AttributeValueRow>(
      db
        .from('catalog_attribute_values')
        .select('id, account_id, product_id, variant_id, attribute_id, value')
        .eq('account_id', accountId)
        .in('product_id', ids),
    ),
    loadRows<RelationRow>(
      db
        .from('catalog_product_relations')
        .select('product_id, related_product_id, kind, sort_order')
        .eq('account_id', accountId)
        .in('product_id', ids),
    ),
  ])

  const collectionIds = unique(collectionLinks.map((row) => row.collection_id))
  const attributeIds = unique(valueRows.map((row) => row.attribute_id))
  const [collections, attributes] = await Promise.all([
    collectionIds.length === 0
      ? Promise.resolve([] as CollectionRow[])
      : loadRows<CollectionRow>(
          db
            .from('catalog_collections')
            .select('id, account_id, handle, title, status')
            .eq('account_id', accountId)
            .in('id', collectionIds),
        ),
    attributeIds.length === 0
      ? Promise.resolve([] as AttributeDefRow[])
      : loadRows<AttributeDefRow>(
          db
            .from('catalog_attributes')
            .select('id, key, label')
            .eq('account_id', accountId)
            .in('id', attributeIds),
        ),
  ])

  const collectionById = new Map(collections.map((row) => [row.id, row]))
  const attributeById = new Map(attributes.map((row) => [row.id, row]))

  const collectionMap = new Map<string, CatalogCollection[]>()
  for (const link of collectionLinks) {
    const col = collectionById.get(link.collection_id)
    if (!col) continue
    const list = collectionMap.get(link.product_id) ?? []
    list.push({
      id: col.id,
      accountId: col.account_id,
      handle: col.handle,
      title: col.title,
      status: parseCatalogStatus(col.status),
    })
    collectionMap.set(link.product_id, list)
  }

  const attributeMap = new Map<string, CatalogAttributeValue[]>()
  for (const row of valueRows) {
    const def = attributeById.get(row.attribute_id)
    const list = attributeMap.get(row.product_id) ?? []
    list.push({
      id: row.id,
      accountId: row.account_id,
      productId: row.product_id,
      variantId: row.variant_id,
      attributeId: row.attribute_id,
      key: def?.key ?? '',
      label: def?.label ?? def?.key ?? '',
      value: row.value,
    })
    attributeMap.set(row.product_id, list)
  }

  const relationMap = new Map<string, CatalogRelationRow[]>()
  for (const row of relationRows) {
    if (!isRelationKind(row.kind)) continue
    const list = relationMap.get(row.product_id) ?? []
    list.push({
      productId: row.product_id,
      relatedProductId: row.related_product_id,
      kind: row.kind,
      sortOrder: Number(row.sort_order) || 0,
    })
    relationMap.set(row.product_id, list)
  }

  return {
    collections: collectionMap,
    attributes: attributeMap,
    relations: relationMap,
  }
}

export async function getCatalogProductsByIds(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<CatalogProduct[]> {
  const ids = unique(productIds)
  if (ids.length === 0) return []
  const { data, error } = await db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', accountId)
    .in('id', ids)
  if (error) throw error
  const products = await hydrateProducts(db, accountId, (data ?? []) as ProductRow[])
  return attachCatalogFacts(db, accountId, products)
}

export async function getCatalogProductsByHandles(
  db: SupabaseClient,
  accountId: string,
  handles: string[],
): Promise<CatalogProduct[]> {
  const uniqueHandles = unique(handles.map((handle) => handle.trim()).filter(Boolean))
  if (uniqueHandles.length === 0) return []
  const { data, error } = await db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', accountId)
    .in('handle', uniqueHandles)
  if (error) throw error
  const products = await hydrateProducts(db, accountId, (data ?? []) as ProductRow[])
  return attachCatalogFacts(db, accountId, products)
}

function isRelationKind(value: string): value is CatalogRelationKind {
  return CATALOG_RELATION_KINDS.includes(value as CatalogRelationKind)
}

async function loadRows<T>(
  req: PromiseLike<{ data: unknown; error: { message?: string } | null }>,
): Promise<T[]> {
  const { data, error } = await req
  if (error) {
    console.warn('[catalog-intel] fact load failed', { error: error.message })
    return []
  }
  return (data ?? []) as T[]
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
