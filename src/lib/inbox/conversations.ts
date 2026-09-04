import type { Conversation, Contact, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/**
 * Inbox list rank: brand-new empty threads first, then unread
 * (priority), then the rest. Recency is newest-first within each
 * group — `created_at` for empty threads, `last_message_at` (falling
 * back to `created_at`) for everyone else.
 */
function isNewInboxChat(conversation: Conversation): boolean {
  return !conversation.last_message_at && !conversation.last_message_text;
}

function inboxSortGroup(conversation: Conversation): 0 | 1 | 2 {
  if (isNewInboxChat(conversation)) return 0;
  if (conversation.unread_count > 0) return 1;
  return 2;
}

function inboxRecencyMs(conversation: Conversation, group: 0 | 1 | 2): number {
  const iso =
    group === 0
      ? conversation.created_at
      : conversation.last_message_at || conversation.created_at;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

export function sortInboxConversations(
  conversations: Conversation[],
): Conversation[] {
  return [...conversations].sort((a, b) => {
    const groupA = inboxSortGroup(a);
    const groupB = inboxSortGroup(b);
    if (groupA !== groupB) return groupA - groupB;
    return inboxRecencyMs(b, groupB) - inboxRecencyMs(a, groupA);
  });
}
