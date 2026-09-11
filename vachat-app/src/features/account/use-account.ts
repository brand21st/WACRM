import { useQuery } from '@tanstack/react-query';

import { fetchAccount } from '@/api/account';
import { useAuth } from '@/features/auth/auth-context';

export function useAccount() {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['account'],
    queryFn: ({ signal }) => fetchAccount(signal),
    enabled: Boolean(accessToken),
  });
}
