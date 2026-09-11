import { parseCatalogProductCard } from '@/lib/parse-catalog-product-card';
import type { Message } from '@/types/messages';

export function messagePreview(message: Message): string {
  const text = message.content_text?.trim();
  if (text) {
    return parseCatalogProductCard(text)?.title ?? text;
  }
  switch (message.content_type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'document':
      return 'Document';
    case 'template':
      return message.template_name || 'Template';
    case 'location':
      return 'Location';
    case 'interactive':
      return 'Interactive';
    case 'call':
      return 'Call';
    case 'order':
      return 'Order';
    default:
      return 'Message';
  }
}

export function replyAuthorLabel(message: Message): string {
  if (message.sender_type === 'customer') return 'Customer';
  if (message.sender_type === 'bot' || message.ai_generated) return 'AI';
  return 'You';
}
