/**
 * Pure decision helper for inbound-message alerts.
 *
 * WhatsApp-web behaviour, scoped to this CRM tab:
 *   - outbound / bot rows never alert
 *   - a message already handled (reconnect replay, duplicate INSERT) is skipped
 *   - if the agent is looking at that thread AND the tab is visible, skip
 *     (they already see the bubble land)
 *   - otherwise play sound + in-app toast; desktop Notification only when
 *     the tab is in the background
 */

export interface IncomingNotifyInput {
  senderType: string;
  conversationId: string;
  messageId: string;
  viewingConversationId: string | null;
  documentHidden: boolean;
  alreadySeen: boolean;
  contentType?: string;
}

export interface IncomingNotifyDecision {
  sound: boolean;
  toast: boolean;
  desktop: boolean;
}

export function viewingConversationIdFromLocation(
  pathname: string,
  search: string,
): string | null {
  if (!pathname.startsWith("/inbox")) return null;
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  return params.get("c");
}

export function shouldNotifyIncoming(
  input: IncomingNotifyInput,
): IncomingNotifyDecision {
  const off: IncomingNotifyDecision = {
    sound: false,
    toast: false,
    desktop: false,
  };
  if (input.alreadySeen) return off;
  if (input.senderType !== "customer") return off;
  if (input.contentType === "call") return off;
  if (!input.messageId || !input.conversationId) return off;

  const watchingThisThread =
    !input.documentHidden &&
    input.viewingConversationId === input.conversationId;
  if (watchingThisThread) return off;

  return {
    sound: true,
    toast: true,
    desktop: input.documentHidden,
  };
}

/** Minimum gap between chimes so a burst of inbound replies doesn't stack. */
export const INCOMING_SOUND_COOLDOWN_MS = 1_200;
