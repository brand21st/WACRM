export const CATALOG_STATUSES = ['draft', 'active', 'archived'] as const
export type CatalogStatus = (typeof CATALOG_STATUSES)[number]

export const CATALOG_ORIGINS = ['shopify_import', 'wacrm'] as const
export type CatalogOrigin = (typeof CATALOG_ORIGINS)[number]

export const CATALOG_MEDIA_ROLES = ['hero', 'listing', 'other'] as const
export type CatalogMediaRole = (typeof CATALOG_MEDIA_ROLES)[number]

export const CATALOG_IMPORT_SOURCES = ['shopify'] as const
export type CatalogImportSource = (typeof CATALOG_IMPORT_SOURCES)[number]

export const CATALOG_RELATION_KINDS = [
  'upsell',
  'cross_sell',
  'bundle',
  'similar',
] as const
export type CatalogRelationKind = (typeof CATALOG_RELATION_KINDS)[number]

export interface CatalogOption {
  name: string
  value: string
}

export interface CatalogExternalId {
  id: string
  accountId: string
  productId: string
  variantId: string | null
  source: string
  entity: 'product' | 'variant'
  externalId: string
}

export interface CatalogVariant {
  id: string
  accountId: string
  productId: string
  title: string
  sku: string | null
  price: number | null
  compareAtPrice: number | null
  currency: string | null
  available: boolean
  inventoryQuantity: number | null
  options: CatalogOption[]
  sortOrder: number
  retailerId: string
}

export interface CatalogMedia {
  id: string
  accountId: string
  productId: string
  url: string
  alt: string | null
  role: CatalogMediaRole
  sortOrder: number
  storagePath?: string | null
}

export const META_COLLECTION_REVIEWS = ['pending', 'live'] as const
export type MetaCollectionReview = (typeof META_COLLECTION_REVIEWS)[number]

export interface CatalogCollection {
  id: string
  accountId: string
  handle: string
  title: string
  status: CatalogStatus
  metaProductSetId?: string | null
  metaCollectionReview?: MetaCollectionReview | null
  productCount?: number
  productIds?: string[]
}

export interface CatalogCollectionDraft {
  id?: string
  accountId: string
  handle: string
  title: string
  status?: CatalogStatus
  productIds?: string[]
}

export interface CatalogAttributeValue {
  id: string
  accountId: string
  productId: string
  variantId: string | null
  attributeId: string
  key: string
  label: string
  value: string
}

export interface CatalogProduct {
  id: string
  accountId: string
  handle: string
  title: string
  description: string
  status: CatalogStatus
  brand: string | null
  productUrl: string | null
  currency: string | null
  priceMin: number | null
  priceMax: number | null
  origin: CatalogOrigin
  locked: boolean
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  variants: CatalogVariant[]
  media: CatalogMedia[]
  externalIds: CatalogExternalId[]
  collections?: CatalogCollection[]
  attributes?: CatalogAttributeValue[]
}

export interface CatalogExternalIdDraft {
  source: string
  entity: 'product' | 'variant'
  externalId: string
}

export interface CatalogVariantDraft {
  title: string
  sku?: string | null
  price?: number | null
  compareAtPrice?: number | null
  currency?: string | null
  available?: boolean
  inventoryQuantity?: number | null
  options?: CatalogOption[]
  sortOrder?: number
  retailerId: string
  externalIds?: CatalogExternalIdDraft[]
}

export interface CatalogMediaDraft {
  url: string
  alt?: string | null
  role?: CatalogMediaRole
  sortOrder?: number
  storagePath?: string | null
}

export interface CatalogProductDraft {
  id?: string
  accountId: string
  handle: string
  title: string
  description?: string
  status?: CatalogStatus
  brand?: string | null
  productUrl?: string | null
  currency?: string | null
  priceMin?: number | null
  priceMax?: number | null
  origin?: CatalogOrigin
  locked?: boolean
  publishedAt?: string | null
  variants?: CatalogVariantDraft[]
  media?: CatalogMediaDraft[]
  collectionIds?: string[]
  externalIds?: CatalogExternalIdDraft[]
}

export const CATALOG_SEARCH_SORTS = [
  'relevance',
  'newest',
  'price_asc',
  'price_desc',
] as const
export type CatalogSearchSort = (typeof CATALOG_SEARCH_SORTS)[number]

export interface CatalogSearchAttributeFilter {
  key: string
  value: string
}

export interface CatalogSearchOptionFilter {
  name: string
  value: string
}

export interface CatalogSearchQuery {
  accountId: string
  text?: string
  status?: CatalogStatus
  inStock?: boolean
  priceMin?: number
  priceMax?: number
  brand?: string
  collectionId?: string
  collectionHandle?: string
  attribute?: CatalogSearchAttributeFilter
  option?: CatalogSearchOptionFilter
  sort?: CatalogSearchSort
  limit?: number
  offset?: number
}

export interface CatalogWriter {
  upsertProduct(draft: CatalogProductDraft): Promise<CatalogProduct | null>
  deleteProduct(productId: string): Promise<boolean>
  replaceImportedAccountProducts(drafts: CatalogProductDraft[]): Promise<void>
}

export interface CatalogReader {
  getById(productId: string): Promise<CatalogProduct | null>
  getByHandle(handle: string): Promise<CatalogProduct | null>
  getByRetailerId(retailerId: string): Promise<CatalogProduct | null>
  listByAccount(query?: Omit<CatalogSearchQuery, 'accountId'>): Promise<CatalogProduct[]>
}

export interface CatalogPort {
  reader: CatalogReader
  writer: CatalogWriter
}
