import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { getSupabase } from '@/lib/supabase';
import type { MobileConversation } from '@/types/conversations';

export function useMarkConversationRead(conversation: MobileConversation | undefined) {
  const queryClient = useQueryClient();
  const id = conversation?.id;
  const unread = conversation?.unread_count ?? 0;

  useEffect(() => {
    if (!id || unread <= 0) return;
    let cancelled = false;

    void getSupabase()
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('id', id)
      .then(({ error }) => {
        if (cancelled || error) return;
        queryClient.setQueryData(['conversations', id], (current: MobileConversation | undefined) =>
          current ? { ...current, unread_count: 0 } : current,
        );
        queryClient.setQueryData(['conversations'], (list: MobileConversation[] | undefined) =>
          list?.map((item) => (item.id === id ? { ...item, unread_count: 0 } : item)),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [id, unread, queryClient]);
}
