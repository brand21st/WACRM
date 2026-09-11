import { useQuery } from '@tanstack/react-query';

import { apiGet } from '@/api/client';
import { useAuth } from '@/features/auth/auth-context';

function authPictureUrl(user: { user_metadata?: Record<string, unknown> } | null): string | null {
  const meta = user?.user_metadata;
  if (!meta) return null;
  for (const key of ['avatar_url', 'picture', 'avatar'] as const) {
    const value = meta[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

export function useBusinessAvatarUrl(): string | null {
  const { user, accessToken } = useAuth();
  const query = useQuery({
    queryKey: ['whatsapp', 'business-avatar'],
    queryFn: ({ signal }) => apiGet<{ url: string | null }>('/api/whatsapp/business-avatar', { signal, quiet: true }),
    enabled: Boolean(accessToken),
    staleTime: 5 * 60_000,
  });
  return query.data?.url || authPictureUrl(user) || null;
}
