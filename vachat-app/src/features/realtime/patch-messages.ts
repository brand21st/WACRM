import type { QueryClient } from '@tanstack/react-query';

import { messagesQueryKey } from '@/features/conversation/use-messages';
import type { Message } from '@/types/messages';

export function isOptimisticMessageId(id: string): boolean {
  return id.startsWith('local-');
}

export function applyMessageInsert(queryClient: QueryClient, incoming: Message) {
  const key = messagesQueryKey(incoming.conversation_id);
  if (!queryClient.getQueryState(key)) return;

  queryClient.setQueryData<Message[]>(key, (current) => {
    const list = current ?? [];
    if (list.some((item) => item.id === incoming.id)) return list;
    const withoutOptimistic = list.filter((item) => !isOptimisticMessageId(item.id));
    return [...withoutOptimistic, incoming].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  });
}

export function applyMessageUpdate(queryClient: QueryClient, incoming: Message) {
  const key = messagesQueryKey(incoming.conversation_id);
  if (!queryClient.getQueryState(key)) return;

  queryClient.setQueryData<Message[]>(key, (current) =>
    (current ?? []).map((item) => (item.id === incoming.id ? { ...item, ...incoming } : item)),
  );
}

export function stampOptimisticMessageId(
  queryClient: QueryClient,
  conversationId: string,
  optimisticId: string,
  serverId: string,
  whatsappMessageId?: string,
) {
  const key = messagesQueryKey(conversationId);
  queryClient.setQueryData<Message[]>(key, (current) =>
    (current ?? []).map((item) =>
      item.id === optimisticId
        ? { ...item, id: serverId, message_id: whatsappMessageId ?? item.message_id }
        : item,
    ),
  );
}
