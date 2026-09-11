import type { QueryClient } from '@tanstack/react-query';

import { loadConversationViaRls } from '@/lib/conversations-rls';
import type { ConversationStatus, MobileConversation } from '@/types/conversations';

export type ConversationRealtimeRow = {
  id: string;
  unread_count?: number;
  last_message_text?: string | null;
  last_message_at?: string | null;
  assigned_agent_id?: string | null;
  ai_autoreply_disabled?: boolean;
  customer_service_expires_at?: string | null;
  status?: ConversationStatus;
};

const hydrating = new Set<string>();

function pickConversationPatch(row: ConversationRealtimeRow): Partial<MobileConversation> {
  const patch: Partial<MobileConversation> = {};
  if (typeof row.unread_count === 'number') patch.unread_count = row.unread_count;
  if ('last_message_text' in row) patch.last_message_text = row.last_message_text ?? null;
  if ('last_message_at' in row) patch.last_message_at = row.last_message_at ?? null;
  if ('assigned_agent_id' in row) patch.assigned_agent_id = row.assigned_agent_id ?? null;
  if (typeof row.ai_autoreply_disabled === 'boolean') {
    patch.ai_autoreply_disabled = row.ai_autoreply_disabled;
  }
  if ('customer_service_expires_at' in row) {
    patch.customer_service_expires_at = row.customer_service_expires_at ?? null;
  }
  if (row.status) patch.status = row.status;
  return patch;
}

function sortByLastMessage(list: MobileConversation[]): MobileConversation[] {
  return [...list].sort((a, b) => {
    const left = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
    const right = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
    return right - left;
  });
}

function upsertList(current: MobileConversation[] | undefined, next: MobileConversation) {
  const list = current ?? [];
  const index = list.findIndex((item) => item.id === next.id);
  if (index === -1) return sortByLastMessage([next, ...list]);
  const copy = [...list];
  copy[index] = next;
  return sortByLastMessage(copy);
}

export function applyConversationPatch(queryClient: QueryClient, row: ConversationRealtimeRow) {
  const patch = pickConversationPatch(row);
  const detailKey = ['conversations', row.id] as const;

  queryClient.setQueryData<MobileConversation>(detailKey, (current) =>
    current ? { ...current, ...patch } : current,
  );

  queryClient.setQueryData<MobileConversation[]>(['conversations'], (current) => {
    if (!current) return current;
    const existing = current.find((item) => item.id === row.id);
    if (!existing) return current;
    return sortByLastMessage(current.map((item) => (item.id === row.id ? { ...item, ...patch } : item)));
  });
}

export function conversationKnownInCache(queryClient: QueryClient, id: string): boolean {
  const list = queryClient.getQueryData<MobileConversation[]>(['conversations']);
  if (list?.some((item) => item.id === id)) return true;
  return Boolean(queryClient.getQueryData<MobileConversation>(['conversations', id]));
}

export async function hydrateConversation(queryClient: QueryClient, id: string) {
  if (hydrating.has(id)) return;
  hydrating.add(id);
  try {
    const conversation = await loadConversationViaRls(id);
    queryClient.setQueryData<MobileConversation>(['conversations', id], (current) =>
      current ? { ...current, ...conversation, contact: conversation.contact ?? current.contact } : conversation,
    );
    queryClient.setQueryData<MobileConversation[]>(['conversations'], (current) =>
      upsertList(current, conversation),
    );
  } catch {
    // Keep the list usable; reconnect/resync will recover.
  } finally {
    hydrating.delete(id);
  }
}
