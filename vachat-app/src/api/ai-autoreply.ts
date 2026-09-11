import { apiSend } from '@/api/client';
import { isOfflineApiError } from '@/lib/api-error';
import {
  setConversationAutoreplyViaRls,
  type ConversationAutoreplyResult,
} from '@/lib/conversations-rls';

export type AutoreplyBody = {
  paused: boolean;
  assign_to_me?: boolean;
};

export async function setConversationAutoreply(
  conversationId: string,
  body: AutoreplyBody,
): Promise<ConversationAutoreplyResult> {
  const updated = await setConversationAutoreplyViaRls(conversationId, body);

  try {
    await apiSend<{ success: boolean; paused: boolean }>(
      `/api/ai/autoreply/${conversationId}`,
      { method: 'POST', body, timeoutMs: 8_000 },
    );
  } catch (error) {
    if (!isOfflineApiError(error)) {
      return updated;
    }
  }

  return updated;
}
