import type { InteractiveButton } from '@/lib/whatsapp/interactive'

/** Stable ids echoed in webhook `interactive_reply_id` when tapped. */
export const WACRM_CHAT_BUTTON_IDS = {
  products: 'wacrm:products',
  orders: 'wacrm:orders',
  agent: 'wacrm:agent',
  help: 'wacrm:help',
} as const

/**
 * Quick-reply buttons appended to full-agent WhatsApp replies (max 3).
 */
export function buildAiChatButtons(shopifyConnected: boolean): InteractiveButton[] {
  if (shopifyConnected) {
    return [
      { id: WACRM_CHAT_BUTTON_IDS.products, title: 'New products' },
      { id: WACRM_CHAT_BUTTON_IDS.orders, title: 'My orders' },
      { id: WACRM_CHAT_BUTTON_IDS.agent, title: 'Talk to agent' },
    ]
  }
  return [
    { id: WACRM_CHAT_BUTTON_IDS.help, title: 'Get help' },
    { id: WACRM_CHAT_BUTTON_IDS.agent, title: 'Talk to agent' },
  ]
}

export function formatButtonTapForModel(
  label: string,
  replyId: string | null | undefined,
): string {
  const id = replyId?.trim()
  if (id?.startsWith('wacrm:')) {
    return `[Customer tapped "${label}" (action: ${id})]`
  }
  return label.trim()
}
