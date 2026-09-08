import type { CatalogProduct, CatalogRelationKind } from '../core/types'

export const COMPARE_CAP = 3
export const CANDIDATE_CAP = 50
export const UNAVAILABLE = 'unavailable'

export type RecommendIntent =
  | 'recommend'
  | 'similar'
  | 'alternative'
  | 'upsell'
  | 'cross_sell'
  | 'bundle'

export type CatalogSalesMode = 'off' | 'shadow' | 'on'

export type SalesStage =
  | 'discovery'
  | 'consideration'
  | 'product_selected'
  | 'cart'
  | 'checkout'
  | 'purchased'
  | 'post_purchase'

export type RecommendReason =
  | 'same_collection'
  | 'same_options'
  | 'same_attribute'
  | 'price_band'
  | 'same_brand'
  | 'relation_similar'
  | 'relation_upsell'
  | 'relation_cross_sell'
  | 'relation_bundle'
  | 'lower_price'
  | 'higher_price'
  | 'seed_variant'
  | 'complements_selected_product'
  | 'same_occasion'
  | 'within_budget'

export type ShoppingContext = {
  occasion?: string
  recipient?: string
  minPrice?: number
  maxPrice?: number
  colors: string[]
  dislikes: string[]
  option?: { name?: string; value: string }
  categoryHint?: string
  selectedIds: string[]
  rejectedIds: string[]
  shownIds: string[]
  stage: SalesStage
}

export type RankedRecommendation = {
  product: CatalogProduct
  mode: RecommendIntent
  score: number
  reasons: RecommendReason[]
}

export interface CatalogRelationRow {
  productId: string
  relatedProductId: string
  kind: CatalogRelationKind
  sortOrder: number
}

export interface ComparisonRow {
  field: string
  values: (string | null)[]
}

export interface CatalogComparison {
  productIds: string[]
  rows: ComparisonRow[]
  notes: string[]
}

export interface CompareCatalogResult {
  products: CatalogProduct[]
  comparison: CatalogComparison
}

export interface RankedCatalogProduct {
  product: CatalogProduct
  score: number
  reasons: RecommendReason[]
}

export interface ShoppingRequirements {
  minPrice?: number
  maxPrice?: number
  cheaper?: boolean
  optionName?: string
  optionValue?: string
  attributeKey?: string
  attributeValue?: string
}

export interface SimilarQuery {
  accountId: string
  seed: CatalogProduct
  limit?: number
  shopName?: string | null
  requirements?: ShoppingRequirements
  intent?: 'similar' | 'alternative' | 'upsell' | 'cheaper'
  relatedIds?: Set<string>
}
