import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock("@/lib/auth/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/account")>(
    "@/lib/auth/account",
  );
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
  };
});

import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { GET } from "./route";

function makeQuery(result: { data: unknown; error: unknown }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => result),
  };
  return builder;
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
});

describe("GET /api/conversations/[id]", () => {
  it("401s when there is no session or Bearer JWT", async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());

    const res = await GET(new Request("https://app.test/api/conversations/c1"), {
      params: Promise.resolve({ id: "c1" }),
    });

    expect(res.status).toBe(401);
  });

  it("404s when the conversation is not in the caller account", async () => {
    const query = makeQuery({ data: null, error: null });
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: "acct-1",
      supabase: { from: () => query },
    });

    const res = await GET(
      new Request("https://app.test/api/conversations/other-acct-conv"),
      { params: Promise.resolve({ id: "other-acct-conv" }) },
    );

    expect(res.status).toBe(404);
    expect(query.eq).toHaveBeenCalledWith("id", "other-acct-conv");
    expect(query.eq).toHaveBeenCalledWith("account_id", "acct-1");
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
    expect(json).not.toHaveProperty("account_id");
  });

  it("returns the mobile DTO for a conversation in the caller account", async () => {
    const row = {
      id: "conv-1",
      user_id: "u1",
      account_id: "acct-1",
      contact_id: "c1",
      status: "open",
      assigned_agent_id: null,
      last_message_text: "hello",
      last_message_at: "2026-09-01T12:00:00.000Z",
      unread_count: 1,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T12:00:00.000Z",
      ai_autoreply_disabled: false,
      last_customer_message_at: "2026-09-01T12:00:00.000Z",
      customer_service_expires_at: "2026-09-02T12:00:00.000Z",
      contact: {
        id: "c1",
        phone: "+1",
        name: "Pat",
        contact_tags: [],
      },
    };
    const query = makeQuery({ data: row, error: null });
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: "acct-1",
      supabase: { from: () => query },
    });

    const res = await GET(new Request("https://app.test/api/conversations/conv-1"), {
      params: Promise.resolve({ id: "conv-1" }),
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.conversation.customer_service_expires_at).toBe(
      "2026-09-02T12:00:00.000Z",
    );
    expect(json.conversation).not.toHaveProperty("account_id");
    expect(json.conversation).not.toHaveProperty("user_id");
  });

  it("maps ForbiddenError from account isolation to 403", async () => {
    mocks.getCurrentAccount.mockRejectedValue(new ForbiddenError());

    const res = await GET(new Request("https://app.test/api/conversations/c1"), {
      params: Promise.resolve({ id: "c1" }),
    });
    expect(res.status).toBe(403);
  });
});
