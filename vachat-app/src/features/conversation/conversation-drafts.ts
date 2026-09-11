const drafts = new Map<string, string>();

export function getConversationDraft(conversationId: string): string {
  return drafts.get(conversationId) ?? '';
}

export function setConversationDraft(conversationId: string, text: string) {
  if (text.trim()) drafts.set(conversationId, text);
  else drafts.delete(conversationId);
}
