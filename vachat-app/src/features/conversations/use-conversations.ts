import { useQuery } from '@tanstack/react-query';

import { fetchConversation, fetchConversations } from '@/api/conversations';
import { useAuth } from '@/features/auth/auth-context';

export function useConversations() {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['conversations'],
    queryFn: ({ signal }) => fetchConversations(signal),
    enabled: Boolean(accessToken),
  });
}

export function useConversation(id: string | undefined) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['conversations', id],
    queryFn: ({ signal }) => fetchConversation(id!, signal),
    enabled: Boolean(accessToken && id),
  });
}
