import type { SupabaseClient } from '@supabase/supabase-js'
import {
  deleteProduct as deleteCatalogProduct,
  replaceImportedAccountProducts,
  upsertProduct as upsertCatalogProduct,
} from './core/commands'
import {
  getCollectionById,
  getProductByHandle,
  getProductById,
  getProductByRetailerId,
  listCollectionsByAccount,
  listProductsByAccount,
} from './core/repository'
import type { CatalogPort, CatalogSearchQuery } from './core/types'

export { getCollectionById, listCollectionsByAccount, listProductsByAccount }
export {
  deleteCollection,
  deleteProduct,
  upsertCollection,
  upsertProduct,
} from './core/commands'

export type {
  CatalogAttributeValue,
  CatalogCollection,
  CatalogCollectionDraft,
  CatalogExternalId,
  CatalogImportSource,
  CatalogMedia,
  CatalogPort,
  CatalogProduct,
  CatalogProductDraft,
  CatalogReader,
  CatalogSearchQuery,
  CatalogSearchSort,
  CatalogStatus,
  CatalogVariant,
  CatalogWriter,
} from './core/types'

export { catalogRetailerIdForVariant, parseRetailerIdSource } from './core/retailer-id'
export {
  isActiveCatalogStatus,
  isCatalogStatus,
  parseCatalogStatus,
} from './core/status'
export { assertCatalogImportCoverage } from './search/consistency'
export {
  CatalogWriteError,
  buildCatalogWriteDraft,
  isAccountCatalogStoragePath,
  makeWacrmRetailerId,
  slugifyCatalogHandle,
} from './http-write'
export { buildCatalogSetDraft, catalogSetToJson } from './http-set'
export {
  loadCatalogAnalyticsMode,
  recordCatalogLineEvents,
  recordCatalogProductEvents,
  setCatalogAnalyticsMode,
} from './analytics/events'
export {
  loadCatalogAnalyticsDashboard,
  loadProductAnalytics,
  parseCatalogAnalyticsRange,
} from './analytics/aggregate'
export { enqueueCatalogEmbedBackfill } from './embeddings/backfill'
export { generateCatalogProductEmbedding } from './embeddings/generate'
export { scheduleCatalogEmbed } from './embeddings/jobs'
export {
  CATALOG_EMBEDDING_DIMENSIONS,
  CATALOG_EMBEDDING_MODEL,
  buildCatalogEmbedDocument,
  hashCatalogEmbedDocument,
} from './search/embed-document'
export {
  applyCatalogHardFilters,
  reciprocalRankFusion,
  searchHybridCatalog,
} from './search/hybrid'
export { lookupCatalogProduct } from './search/lookup'
export { catalogProductToHit } from './search/map-hit'
export { loadCatalogHybridMode } from './search/semantic'
export { compareCatalogProducts } from './intelligence/compare'
export { attachCatalogFacts, loadCatalogFacts } from './intelligence/facts'
export { listRelatedProducts } from './intelligence/relations'
export { parseShoppingRequirements } from './intelligence/requirements'
export { findAlternativeProducts, findSimilarProducts } from './intelligence/similar'
export {
  getRecommendations,
  loadCatalogSalesMode,
  recordShownRecommendationEvents,
} from './intelligence/recommend'
export {
  mergeAndPersistShoppingContext,
  parseShoppingFacts,
} from './intelligence/shopping-context'
export { deriveSalesStage } from './intelligence/sales-stage'
export {
  catalogSearchFetchLimit,
  getCatalogProduct,
  getCatalogProductByHandle,
  getCatalogProductByRetailerId,
  listNewArrivalsCatalog,
  logCatalogSearch,
  sanitizeCatalogSearch,
  searchCatalog,
} from './search/query'

export function createCatalogPort(
  db: SupabaseClient,
  accountId: string,
): CatalogPort {
  return {
    reader: {
      getById: (productId) => getProductById(db, accountId, productId),
      getByHandle: (handle) => getProductByHandle(db, accountId, handle),
      getByRetailerId: (retailerId) =>
        getProductByRetailerId(db, accountId, retailerId),
      listByAccount: (query?: Omit<CatalogSearchQuery, 'accountId'>) =>
        listProductsByAccount(db, { accountId, ...query }),
    },
    writer: {
      upsertProduct: (draft) => upsertCatalogProduct(db, { ...draft, accountId }),
      deleteProduct: (productId) => deleteCatalogProduct(db, accountId, productId),
      replaceImportedAccountProducts: (drafts) =>
        replaceImportedAccountProducts(
          db,
          accountId,
          drafts.map((draft) => ({ ...draft, accountId })),
        ),
    },
  }
}
