import { useMutation } from '@tanstack/react-query';

import { reactToWhatsAppMessage } from '@/api/whatsapp';

export function useReactToMessage(conversationId: string) {
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      reactToWhatsAppMessage(messageId, emoji),
    mutationKey: ['react-to-message', conversationId],
  });
}
