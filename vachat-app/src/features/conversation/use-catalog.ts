import { useQuery } from '@tanstack/react-query';

import { fetchActiveCatalog } from '@/api/catalog';
import { useAuth } from '@/features/auth/auth-context';

export function useActiveCatalog(enabled: boolean) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['catalog', 'active'],
    queryFn: ({ signal }) => fetchActiveCatalog(signal),
    enabled: Boolean(accessToken && enabled),
  });
}
