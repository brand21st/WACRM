import { CATALOG_STATUSES, type CatalogStatus } from './types'

export function parseCatalogStatus(raw: unknown): CatalogStatus {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return CATALOG_STATUSES.includes(value as CatalogStatus)
    ? (value as CatalogStatus)
    : 'draft'
}

export function isActiveCatalogStatus(status: CatalogStatus): boolean {
  return status === 'active'
}

export function isCatalogStatus(raw: unknown): raw is CatalogStatus {
  return (
    typeof raw === 'string' &&
    CATALOG_STATUSES.includes(raw.trim().toLowerCase() as CatalogStatus)
  )
}
