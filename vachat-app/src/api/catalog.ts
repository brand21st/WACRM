import { apiGet } from '@/api/client';
import type { CatalogListItem, CatalogListResponse } from '@/types/catalog';

export async function fetchActiveCatalog(signal?: AbortSignal): Promise<CatalogListItem[]> {
  const data = await apiGet<CatalogListResponse>('/api/catalog?status=active&limit=50', { signal });
  return data.products;
}
