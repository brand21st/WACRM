import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
}));

vi.mock("@/lib/auth/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/account")>(
    "@/lib/auth/account",
  );
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
    requireRole: mocks.requireRole,
  };
});

vi.mock("@/lib/ai/platform-settings", () => ({
  chatKeyForProvider: vi.fn(() => null),
  loadPlatformAiSettings: vi.fn(async () => null),
}));

import { ForbiddenError } from "@/lib/auth/account";
import { GET, POST } from "./route";

beforeEach(() => {
  mocks.getCurrentAccount.mockReset();
  mocks.requireRole.mockReset();
});

describe("GET /api/ai/config", () => {
  it("allows any member and never returns api_key", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: "acct-1",
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  provider: "openai",
                  model: "gpt-4o",
                  system_prompt: "be helpful",
                  is_active: true,
                  auto_reply_enabled: true,
                  full_agent_enabled: false,
                },
                error: null,
              }),
            }),
          }),
        }),
      },
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.configured).toBe(true);
    expect(json).not.toHaveProperty("api_key");
    expect(JSON.stringify(json)).not.toMatch(/sk-|api_key|ENCRYPTION/i);
  });
});

describe("POST /api/ai/config", () => {
  it("rejects a viewer (requireRole admin)", async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    );

    const res = await POST(
      new Request("https://app.test/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      }),
    );

    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });

  it("rejects an agent (requireRole admin)", async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    );

    const res = await POST(
      new Request("https://app.test/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      }),
    );

    expect(res.status).toBe(403);
    expect(mocks.requireRole).toHaveBeenCalledWith("admin");
  });
});
