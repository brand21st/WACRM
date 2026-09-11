import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import {
  applyConversationPatch,
  conversationKnownInCache,
  hydrateConversation,
  type ConversationRealtimeRow,
} from '@/features/realtime/patch-conversation';
import { applyMessageInsert, applyMessageUpdate } from '@/features/realtime/patch-messages';
import { resyncInboxQueries } from '@/features/realtime/resync-queries';
import { logger } from '@/lib/logger';
import { getSupabase } from '@/lib/supabase';
import type { Message } from '@/types/messages';

export type RealtimeStatus = {
  isConnected: boolean;
  everConnected: boolean;
};

export function useInboxRealtime(enabled: boolean): RealtimeStatus {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [everConnected, setEverConnected] = useState(false);
  const everConnectedRef = useRef(false);
  const wasConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setIsConnected(false);
      return;
    }

    const supabase = getSupabase();
    const channel = supabase
      .channel('inbox-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as Message;
          if (!row?.conversation_id || !row.id) return;
          if (payload.eventType === 'INSERT') {
            logger.info('[REALTIME] message INSERT');
            applyMessageInsert(queryClient, row);
            return;
          }
          if (payload.eventType === 'UPDATE') {
            logger.info('[REALTIME] message UPDATE');
            applyMessageUpdate(queryClient, row);
          }
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations' },
        (payload) => {
          const row = payload.new as ConversationRealtimeRow;
          if (!row?.id) return;
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            logger.info('[REALTIME] conversation UPDATE');
            if (conversationKnownInCache(queryClient, row.id)) {
              applyConversationPatch(queryClient, row);
              return;
            }
            void hydrateConversation(queryClient, row.id);
          }
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.info('[REALTIME] connected');
          if (everConnectedRef.current && !wasConnectedRef.current) {
            resyncInboxQueries(queryClient);
          }
          everConnectedRef.current = true;
          wasConnectedRef.current = true;
          setEverConnected(true);
          setIsConnected(true);
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (everConnectedRef.current) {
            logger.info('[REALTIME] reconnecting');
          }
          wasConnectedRef.current = false;
          setIsConnected(false);
        }
      });

    return () => {
      wasConnectedRef.current = false;
      setIsConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [enabled, queryClient]);

  return { isConnected, everConnected };
}
