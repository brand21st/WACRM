import { apiSend } from '@/api/client';
import type { SendMessageBody, SendMessageResponse } from '@/types/messages';
import type { ChannelType } from '@/types/conversations';

export function sendWhatsAppMessage(
  body: SendMessageBody,
  channel: ChannelType = 'whatsapp',
): Promise<SendMessageResponse> {
  const path = channel === 'whatsapp' ? '/api/whatsapp/send' : '/api/meta/send';
  return apiSend<SendMessageResponse>(path, { method: 'POST', body });
}

export function reactToWhatsAppMessage(messageId: string, emoji: string): Promise<{ success: boolean }> {
  return apiSend<{ success: boolean }>('/api/whatsapp/react', {
    method: 'POST',
    body: { message_id: messageId, emoji },
  });
}
