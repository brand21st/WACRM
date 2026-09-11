import type { MobileConversation } from '@/types/conversations';

export type ChatFilter = 'all' | 'unread' | 'ai' | 'manual' | 'groups' | 'initiatives';

export const CHAT_FILTERS: { id: ChatFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'ai', label: 'AI' },
  { id: 'manual', label: 'Manual' },
  { id: 'groups', label: 'Groups' },
  { id: 'initiatives', label: 'Initiatives' },
];

export function conversationDisplayName(conversation: MobileConversation): string {
  return conversation.contact?.name || conversation.contact?.phone || 'Unknown';
}

export function isManualConversation(conversation: MobileConversation, fullAgentOn: boolean): boolean {
  return Boolean(fullAgentOn && (conversation.ai_autoreply_disabled || conversation.assigned_agent_id));
}

export function isAiConversation(conversation: MobileConversation, fullAgentOn: boolean): boolean {
  return Boolean(fullAgentOn && !conversation.ai_autoreply_disabled && !conversation.assigned_agent_id);
}

export function matchesConversationSearch(conversation: MobileConversation, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const name = conversation.contact?.name?.toLowerCase() ?? '';
  const phone = conversation.contact?.phone?.toLowerCase() ?? '';
  const last = conversation.last_message_text?.toLowerCase() ?? '';
  return name.includes(needle) || phone.includes(needle) || last.includes(needle);
}

export function filterConversations(
  conversations: MobileConversation[],
  filter: ChatFilter,
  fullAgentOn: boolean,
  query: string,
  tag: string | null = null,
): MobileConversation[] {
  if (filter === 'groups' || filter === 'initiatives') return [];

  let next = conversations;
  
  if (tag) {
    next = next.filter((item) => item.contact?.tags?.some(t => t.name === tag));
  }

  if (filter === 'unread') {
    next = next.filter((item) => item.unread_count > 0);
  } else if (filter === 'manual') {
    next = next.filter((item) => isManualConversation(item, fullAgentOn));
  } else if (filter === 'ai') {
    next = next.filter((item) => isAiConversation(item, fullAgentOn));
  }

  return next.filter((item) => matchesConversationSearch(item, query));
}
