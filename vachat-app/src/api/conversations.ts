import { apiGet } from '@/api/client';
import { isOfflineApiError } from '@/lib/api-error';
import { loadConversationViaRls, loadConversationsViaRls } from '@/lib/conversations-rls';
import type { ConversationResponse, ConversationsResponse, MobileConversation } from '@/types/conversations';

export async function fetchConversations(signal?: AbortSignal): Promise<MobileConversation[]> {
  try {
    const data = await apiGet<ConversationsResponse>('/api/conversations?limit=100', {
      signal,
      quiet: true,
    });
    return data.conversations;
  } catch (error) {
    try {
      return await loadConversationsViaRls();
    } catch {
      throw error;
    }
  }
}

export async function fetchConversation(id: string, signal?: AbortSignal): Promise<MobileConversation> {
  try {
    const data = await apiGet<ConversationResponse>(`/api/conversations/${id}`, {
      signal,
      quiet: true,
    });
    return data.conversation;
  } catch (error) {
    try {
      return await loadConversationViaRls(id);
    } catch {
      throw error;
    }
  }
}
