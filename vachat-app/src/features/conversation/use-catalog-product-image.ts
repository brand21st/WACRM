import { useQuery } from '@tanstack/react-query';

import { fetchCatalogProductImage } from '@/lib/catalog-product-lookup';

export function useCatalogProductImage(
  handle: string,
  viewUrl: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['catalog-product-image', handle, viewUrl],
    queryFn: () => fetchCatalogProductImage(handle, viewUrl),
    enabled: enabled && Boolean(handle),
    staleTime: 10 * 60 * 1000,
  });
}
