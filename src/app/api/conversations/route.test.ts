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
import { GET } from "./route";

function makeListQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
});

describe("GET /api/conversations", () => {
  it("401s without a cookie session or Bearer JWT", async () => {
    mocks.getCurrentAccount.mockRejectedValue(new UnauthorizedError());

    const res = await GET(new Request("https://app.test/api/conversations"));
    expect(res.status).toBe(401);
  });

  it("scopes the list to the caller account_id", async () => {
    const query = makeListQuery({ data: [], error: null });
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: "acct-1",
      supabase: { from: () => query },
    });

    const res = await GET(new Request("https://app.test/api/conversations"));
    expect(res.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith("account_id", "acct-1");
    const json = await res.json();
    expect(json.conversations).toEqual([]);
  });
});
