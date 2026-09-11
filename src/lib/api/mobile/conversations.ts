import { customerServiceExpiresAt } from "@/lib/inbox/session-window";
import type { Conversation, MobileConversation } from "@/types";

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * Canonical 24h window expiry for a conversation row.
 * Prefers the generated DB column; falls back to the shared helper
 * so fixtures without the column still produce a correct ISO.
 */
export function conversationExpiresAtIso(
  conv: Pick<
    Conversation,
    "customer_service_expires_at" | "last_customer_message_at"
  >,
): string | null {
  const fromColumn = toIsoOrNull(conv.customer_service_expires_at);
  if (fromColumn) return fromColumn;
  const computed = customerServiceExpiresAt(conv.last_customer_message_at);
  return computed ? computed.toISOString() : null;
}

/**
 * Project a conversation (after {@link normalizeConversation}) into
 * the mobile DTO. Drops tenancy keys and anything Expo must not see.
 */
export function serializeMobileConversation(
  conv: Conversation,
): MobileConversation {
  const c = conv.contact;
  return {
    id: conv.id,
    status: conv.status,
    assigned_agent_id: conv.assigned_agent_id ?? null,
    last_message_text: conv.last_message_text ?? null,
    last_message_at: conv.last_message_at ?? null,
    unread_count: conv.unread_count ?? 0,
    ai_autoreply_disabled: conv.ai_autoreply_disabled === true,
    customer_service_expires_at: conversationExpiresAtIso(conv),
    created_at: conv.created_at,
    updated_at: conv.updated_at,
    contact: c
      ? {
          id: c.id,
          phone: c.phone,
          name: c.name ?? null,
          email: c.email ?? null,
          company: c.company ?? null,
          avatar_url: c.avatar_url ?? null,
          tags: (c.tags ?? []).map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
          })),
        }
      : null,
  };
}
