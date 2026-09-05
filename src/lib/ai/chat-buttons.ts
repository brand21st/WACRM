import type { InteractiveButton } from '@/lib/whatsapp/interactive'

/** Stable ids echoed in webhook `interactive_reply_id` when tapped. */
export const WACRM_CHAT_BUTTON_IDS = {
  products: 'wacrm:products',
  orders: 'wacrm:orders',
  agent: 'wacrm:agent',
  help: 'wacrm:help',
  confirmOrder: 'wacrm:confirm_order',
  moreOptions: 'wacrm:more_options',
  continueChat: 'wacrm:continue_chat',
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

/** Confirm / browse-more buttons on cart-offer turns (max 20 chars each). */
export function buildCartOfferButtons(): InteractiveButton[] {
  return [
    { id: WACRM_CHAT_BUTTON_IDS.confirmOrder, title: 'Confirm order' },
    { id: WACRM_CHAT_BUTTON_IDS.moreOptions, title: 'Check other options' },
  ]
}

/** Confirm / keep chatting after a focused product's variants are chosen. */
export function buildProductOrderButtons(): InteractiveButton[] {
  return [
    { id: WACRM_CHAT_BUTTON_IDS.confirmOrder, title: 'Confirm order' },
    { id: WACRM_CHAT_BUTTON_IDS.continueChat, title: 'Continue chat' },
  ]
}

export function lastMessageHasAction(
  messages: { content: string }[],
  actionId: string,
): boolean {
  const last = messages[messages.length - 1]?.content
  return Boolean(last?.includes(actionId))
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
