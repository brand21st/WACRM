import type { ShopifyStoreConfig } from './types'

export function catalogOnlyStoreConfig(
  accountId: string,
  extras?: Partial<ShopifyStoreConfig>,
): ShopifyStoreConfig {
  return {
    accountId,
    shopDomain: extras?.shopDomain ?? '',
    accessToken: extras?.accessToken ?? '',
    isActive: extras?.isActive ?? false,
    shopName: extras?.shopName ?? null,
    primaryDomain: extras?.primaryDomain ?? null,
    currency: extras?.currency ?? null,
    metaCatalogId: extras?.metaCatalogId ?? null,
    lastVerifiedAt: extras?.lastVerifiedAt ?? null,
    lastCatalogSyncAt: extras?.lastCatalogSyncAt ?? null,
    catalogProductCount: extras?.catalogProductCount ?? 0,
  }
}

export function isShopifyStoreConnected(
  config: ShopifyStoreConfig | null | undefined,
): boolean {
  return Boolean(config?.shopDomain?.trim() && config?.accessToken?.trim())
}
