import { apiSend } from '@/api/client';
import type { SendMessageBody, SendMessageResponse } from '@/types/messages';

export function sendWhatsAppMessage(body: SendMessageBody): Promise<SendMessageResponse> {
  return apiSend<SendMessageResponse>('/api/whatsapp/send', { method: 'POST', body });
}

export function reactToWhatsAppMessage(messageId: string, emoji: string): Promise<{ success: boolean }> {
  return apiSend<{ success: boolean }>('/api/whatsapp/react', {
    method: 'POST',
    body: { message_id: messageId, emoji },
  });
}
