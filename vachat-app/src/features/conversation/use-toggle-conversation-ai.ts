import { useMutation, useQueryClient } from '@tanstack/react-query';

import { setConversationAutoreply } from '@/api/ai-autoreply';
import { applyConversationPatch } from '@/features/realtime/patch-conversation';
import { getSupabase } from '@/lib/supabase';
import type { MobileConversation } from '@/types/conversations';

function upsertConversationList(
  current: MobileConversation[] | undefined,
  next: MobileConversation,
): MobileConversation[] | undefined {
  if (!current) return current;
  const index = current.findIndex((item) => item.id === next.id);
  if (index === -1) return current;
  const copy = [...current];
  copy[index] = {
    ...copy[index],
    ...next,
    contact: next.contact ?? copy[index].contact,
  };
  return copy;
}

export function useToggleConversationAi(conversationId: string) {
  const queryClient = useQueryClient();
  const detailKey = ['conversations', conversationId] as const;

  return useMutation({
    mutationFn: (nextOn: boolean) =>
      setConversationAutoreply(
        conversationId,
        nextOn ? { paused: false } : { paused: true, assign_to_me: true },
      ),
    onMutate: async (nextOn) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const previous = queryClient.getQueryData<MobileConversation>(detailKey);
      const { data } = await getSupabase().auth.getSession();
      const userId = data.session?.user.id ?? null;
      const paused = !nextOn;
      applyConversationPatch(queryClient, {
        id: conversationId,
        ai_autoreply_disabled: paused,
        assigned_agent_id: paused ? userId : null,
      });
      return { previous };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<MobileConversation>(detailKey, (current) =>
        current
          ? {
              ...current,
              ...result.conversation,
              contact: result.conversation.contact ?? current.contact,
            }
          : result.conversation,
      );
      queryClient.setQueryData<MobileConversation[]>(['conversations'], (current) =>
        upsertConversationList(current, result.conversation),
      );
    },
    onError: (_error, _nextOn, context) => {
      if (context?.previous) {
        queryClient.setQueryData(detailKey, context.previous);
      }
    },
  });
}
