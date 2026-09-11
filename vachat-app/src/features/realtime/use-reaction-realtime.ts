import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { reactionsQueryKey } from '@/features/conversation/use-messages';
import { getSupabase } from '@/lib/supabase';
import type { MessageReaction } from '@/types/messages';

function applyReactionInsert(current: MessageReaction[] | undefined, row: MessageReaction) {
  const list = current ?? [];
  if (list.some((item) => item.id === row.id)) return list;
  return [...list, row];
}

function applyReactionUpdate(current: MessageReaction[] | undefined, row: MessageReaction) {
  return (current ?? []).map((item) => (item.id === row.id ? { ...item, ...row } : item));
}

function applyReactionDelete(current: MessageReaction[] | undefined, oldId: string | undefined) {
  if (!oldId) return current;
  return (current ?? []).filter((item) => item.id !== oldId);
}

export function useReactionRealtime(conversationId: string | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

    const supabase = getSupabase();
    const key = reactionsQueryKey(conversationId);
    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          if (!row?.id) return;
          queryClient.setQueryData<MessageReaction[]>(key, (current) => applyReactionInsert(current, row));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          if (!row?.id) return;
          queryClient.setQueryData<MessageReaction[]>(key, (current) => applyReactionUpdate(current, row));
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'message_reactions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          queryClient.setQueryData<MessageReaction[]>(key, (current) => applyReactionDelete(current, old.id));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}
