import { fetchAccount } from '@/api/account';
import { fetchConversations } from '@/api/conversations';
import { isApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';

export type SessionSmokeResult = {
  ok: boolean;
  accountName: string | null;
  conversationCount: number | null;
  message: string;
};

export async function runSessionSmoke(): Promise<SessionSmokeResult> {
  try {
    const account = await fetchAccount();
    logger.info('[API] account loaded');
    const conversations = await fetchConversations();
    logger.info(`[API] conversations loaded: ${conversations.length}`);
    return {
      ok: true,
      accountName: account.account.name,
      conversationCount: conversations.length,
      message: `Account loaded. Conversations: ${conversations.length}`,
    };
  } catch (error) {
    const message = isApiError(error) ? error.message : 'Smoke test failed';
    logger.info('[API] smoke failed', { message });
    return {
      ok: false,
      accountName: null,
      conversationCount: null,
      message,
    };
  }
}
