import { describe, expect, it } from "vitest";
import type { Conversation } from "@/types";
import {
  conversationExpiresAtIso,
  serializeMobileConversation,
} from "./conversations";

function makeConversation(
  overrides: Partial<Conversation> = {},
): Conversation {
  return {
    id: "conv-1",
    user_id: "internal-user",
    account_id: "internal-acct",
    contact_id: "c1",
    status: "open",
    assigned_agent_id: "agent-1",
    last_message_text: "hi",
    last_message_at: "2026-09-02T12:00:00.000Z",
    unread_count: 2,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-02T12:00:00.000Z",
    ai_autoreply_disabled: true,
    last_customer_message_at: "2026-09-01T12:00:00.000Z",
    customer_service_expires_at: "2026-09-02T12:00:00.000Z",
    contact: {
      id: "c1",
      user_id: "internal-user",
      account_id: "internal-acct",
      phone: "+15551234567",
      name: "Jane",
      email: "jane@example.com",
      company: "Acme",
      avatar_url: "https://example.com/a.png",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      tags: [{ id: "t1", name: "vip", color: "#fff", created_at: "2026-01-01T00:00:00.000Z", user_id: "u" }],
    },
    ...overrides,
  };
}

describe("conversationExpiresAtIso", () => {
  it("uses the generated column when present", () => {
    expect(
      conversationExpiresAtIso({
        customer_service_expires_at: "2026-09-02T12:00:00.000Z",
        last_customer_message_at: "2026-09-01T12:00:00.000Z",
      }),
    ).toBe("2026-09-02T12:00:00.000Z");
  });

  it("computes start + 24h from last_customer_message_at when the column is missing", () => {
    expect(
      conversationExpiresAtIso({
        last_customer_message_at: "2026-09-01T12:00:00.000Z",
      }),
    ).toBe("2026-09-02T12:00:00.000Z");
  });

  it("still returns the ISO for an already-expired window", () => {
    expect(
      conversationExpiresAtIso({
        last_customer_message_at: "2020-01-01T00:00:00.000Z",
      }),
    ).toBe("2020-01-02T00:00:00.000Z");
  });

  it("returns null when there is no customer message", () => {
    expect(
      conversationExpiresAtIso({
        last_customer_message_at: null,
        customer_service_expires_at: null,
      }),
    ).toBeNull();
  });
});

describe("serializeMobileConversation", () => {
  it("includes customer_service_expires_at and required mobile fields", () => {
    const out = serializeMobileConversation(makeConversation());
    expect(out).toEqual({
      id: "conv-1",
      status: "open",
      assigned_agent_id: "agent-1",
      last_message_text: "hi",
      last_message_at: "2026-09-02T12:00:00.000Z",
      unread_count: 2,
      ai_autoreply_disabled: true,
      customer_service_expires_at: "2026-09-02T12:00:00.000Z",
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-02T12:00:00.000Z",
      contact: {
        id: "c1",
        phone: "+15551234567",
        name: "Jane",
        email: "jane@example.com",
        company: "Acme",
        avatar_url: "https://example.com/a.png",
        tags: [{ id: "t1", name: "vip", color: "#fff" }],
      },
    });
  });

  it("omits account_id, user_id, and credential-like fields", () => {
    const out = serializeMobileConversation(
      makeConversation({
        ai_handoff_summary: "internal note",
        ai_reply_count: 3,
      }),
    );
    expect(out).not.toHaveProperty("account_id");
    expect(out).not.toHaveProperty("user_id");
    expect(out).not.toHaveProperty("access_token");
    expect(out).not.toHaveProperty("api_key");
    expect(out).not.toHaveProperty("ENCRYPTION");
    expect(out).not.toHaveProperty("ai_handoff_summary");
    expect(out).not.toHaveProperty("ai_reply_count");
    expect(JSON.stringify(out)).not.toMatch(/internal-acct/);
    expect(JSON.stringify(out)).not.toMatch(/access_token|api_key|ENCRYPTION/i);
  });
});
