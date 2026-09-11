import { useMutation, useQueryClient } from '@tanstack/react-query';

import { sendWhatsAppMessage } from '@/api/whatsapp';
import { messagesQueryKey } from '@/features/conversation/use-messages';
import { stampOptimisticMessageId } from '@/features/realtime/patch-messages';
import type { Message, SendMessageBody } from '@/types/messages';

export function useSendMessage(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Omit<SendMessageBody, 'conversation_id'>) =>
      sendWhatsAppMessage({ ...body, conversation_id: conversationId }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: messagesQueryKey(conversationId) });
      const previous = queryClient.getQueryData<Message[]>(messagesQueryKey(conversationId));
      const optimistic: Message = {
        id: `local-${Date.now()}`,
        conversation_id: conversationId,
        sender_type: 'agent',
        content_type: body.message_type === 'template' ? 'template' : body.message_type,
        content_text: body.content_text,
        media_url: body.media_url,
        status: 'sending',
        created_at: new Date().toISOString(),
        reply_to_message_id: body.reply_to_message_id,
      };
      queryClient.setQueryData<Message[]>(messagesQueryKey(conversationId), (current) => [
        ...(current ?? []),
        optimistic,
      ]);
      return { previous, optimisticId: optimistic.id };
    },
    onError: (_error, _body, context) => {
      if (!context) return;
      queryClient.setQueryData<Message[]>(messagesQueryKey(conversationId), (current) =>
        (current ?? []).map((item) =>
          item.id === context.optimisticId ? { ...item, status: 'failed' } : item,
        ),
      );
    },
    onSuccess: (response, _body, context) => {
      if (!context?.optimisticId || !response.message_id) return;
      stampOptimisticMessageId(
        queryClient,
        conversationId,
        context.optimisticId,
        response.message_id,
        response.whatsapp_message_id,
      );
    },
  });
}
