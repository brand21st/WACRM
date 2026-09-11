export interface IncomingNotifyInput {
  senderType: string;
  conversationId: string;
  messageId: string;
  viewingConversationId: string | null;
  appInactive: boolean;
  alreadySeen: boolean;
  contentType?: string;
}

export interface IncomingNotifyDecision {
  sound: boolean;
  toast: boolean;
  push: boolean;
}

export function viewingConversationIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/?#]+)/);
  return match?.[1] ?? null;
}

export function shouldNotifyIncoming(input: IncomingNotifyInput): IncomingNotifyDecision {
  const off: IncomingNotifyDecision = { sound: false, toast: false, push: false };
  if (input.alreadySeen) return off;
  if (input.senderType !== 'customer') return off;
  if (input.contentType === 'call') return off;
  if (!input.messageId || !input.conversationId) return off;

  const watchingThisThread =
    !input.appInactive && input.viewingConversationId === input.conversationId;
  if (watchingThisThread) return off;

  return {
    sound: true,
    toast: true,
    push: input.appInactive,
  };
}

export const INCOMING_SOUND_COOLDOWN_MS = 1_200;
