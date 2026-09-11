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

import { UnauthorizedError } from "@/lib/auth/account";
import { DELETE, POST } from "./route";

function upsertQuery(error: unknown = null) {
  return {
    upsert: vi.fn(() => Promise.resolve({ error })),
  };
}

function deleteQuery(error: unknown = null) {
  const builder: Record<string, unknown> = {
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: (resolve: (v: unknown) => unknown) => resolve({ error }),
  };
  return builder;
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
});

describe("POST /api/device-push-tokens", () => {
  it("401s without a session", async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());
    const res = await POST(
      new Request("https://app.test/api/device-push-tokens", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("400s on a junk token", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      userId: "u1",
      accountId: "acc-1",
      supabase: { from: vi.fn() },
    });
    const res = await POST(
      new Request("https://app.test/api/device-push-tokens", {
        method: "POST",
        body: JSON.stringify({
          expo_push_token: "nope",
          platform: "ios",
        }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("upserts the caller's token onto their account", async () => {
    const query = upsertQuery();
    mocks.getCurrentAccount.mockResolvedValue({
      userId: "u1",
      accountId: "acc-1",
      supabase: { from: () => query },
    });
    const res = await POST(
      new Request("https://app.test/api/device-push-tokens", {
        method: "POST",
        body: JSON.stringify({
          expo_push_token: "ExponentPushToken[abc]",
          platform: "android",
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(query.upsert).toHaveBeenCalledWith(
      {
        user_id: "u1",
        account_id: "acc-1",
        expo_push_token: "ExponentPushToken[abc]",
        platform: "android",
      },
      { onConflict: "expo_push_token" },
    );
  });
});

describe("DELETE /api/device-push-tokens", () => {
  it("deletes only the caller's matching token", async () => {
    const query = deleteQuery();
    mocks.getCurrentAccount.mockResolvedValue({
      userId: "u1",
      accountId: "acc-1",
      supabase: { from: () => query },
    });
    const res = await DELETE(
      new Request("https://app.test/api/device-push-tokens", {
        method: "DELETE",
        body: JSON.stringify({ expo_push_token: "ExponentPushToken[abc]" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("user_id", "u1");
    expect(query.eq).toHaveBeenCalledWith(
      "expo_push_token",
      "ExponentPushToken[abc]",
    );
  });
});
