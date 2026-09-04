import { describe, it, expect } from "vitest";
import {
  matchesContactFilters,
  normalizeConversation,
  sortInboxConversations,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
    ...overrides,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe("sortInboxConversations", () => {
  it("puts a newer last_message_at above an older unread thread", () => {
    const unread = makeConversation(null, {
      id: "unread",
      unread_count: 19,
      last_message_text: "Order #1104",
      last_message_at: "2026-09-04T12:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    const later = makeConversation(null, {
      id: "later",
      last_message_text: "Thanks",
      last_message_at: "2026-09-04T18:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    expect(sortInboxConversations([unread, later]).map((c) => c.id)).toEqual([
      "later",
      "unread",
    ]);
  });

  it("puts a just-messaged thread above an empty chat with an older created_at", () => {
    const empty = makeConversation(null, {
      id: "empty",
      created_at: "2026-09-04T08:00:00.000Z",
    });
    const justMessaged = makeConversation(null, {
      id: "just-messaged",
      last_message_text: "Hi",
      last_message_at: "2026-09-04T12:00:00.000Z",
      created_at: "2026-09-04T11:00:00.000Z",
    });
    expect(
      sortInboxConversations([empty, justMessaged]).map((c) => c.id),
    ).toEqual(["just-messaged", "empty"]);
  });

  it("orders two empty chats by created_at newest first", () => {
    const older = makeConversation(null, {
      id: "older",
      created_at: "2026-09-03T00:00:00.000Z",
    });
    const newer = makeConversation(null, {
      id: "newer",
      created_at: "2026-09-04T00:00:00.000Z",
    });
    expect(sortInboxConversations([older, newer]).map((c) => c.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("orders two read threads by last_message_at newest first", () => {
    const older = makeConversation(null, {
      id: "older",
      last_message_text: "Old",
      last_message_at: "2026-09-04T10:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    const newer = makeConversation(null, {
      id: "newer",
      last_message_text: "New",
      last_message_at: "2026-09-04T18:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    expect(sortInboxConversations([older, newer]).map((c) => c.id)).toEqual([
      "newer",
      "older",
    ]);
  });
});
