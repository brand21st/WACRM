import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/ai/admin-client", () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}));

import {
  incomingPushCopy,
  isExpoPushToken,
  notifyAccountDevicesOfIncomingMessage,
  EXPO_PUSH_URL,
} from "./expo-push";

function tokenQuery(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    in: vi.fn(() => Promise.resolve({ error: null })),
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  return builder;
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
});

describe("isExpoPushToken", () => {
  it("accepts Expo token shapes and rejects junk", () => {
    expect(isExpoPushToken("ExponentPushToken[abc123]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[xyz]")).toBe(true);
    expect(isExpoPushToken("ExponentPushToken[]")).toBe(false);
    expect(isExpoPushToken("not-a-token")).toBe(false);
  });
});

describe("incomingPushCopy", () => {
  it("matches the web toast title and media placeholders", () => {
    expect(
      incomingPushCopy({
        contactName: "Ada",
        contentType: "text",
        contentText: "hello",
      }),
    ).toEqual({
      title: "New message from Ada",
      body: "hello",
    });
    expect(
      incomingPushCopy({
        contactPhone: "+1555",
        contentType: "audio",
        contentText: "",
      }),
    ).toEqual({
      title: "New message from +1555",
      body: "Voice message",
    });
  });
});

describe("notifyAccountDevicesOfIncomingMessage", () => {
  it("no-ops for call bubbles and empty accounts", async () => {
    await notifyAccountDevicesOfIncomingMessage({
      accountId: "acc-1",
      conversationId: "conv-1",
      contentType: "call",
    });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("sends one Expo message per registered token", async () => {
    mocks.from.mockReturnValue(
      tokenQuery({
        data: [
          { id: "t1", expo_push_token: "ExponentPushToken[aaa]" },
          { id: "t2", expo_push_token: "garbage" },
        ],
        error: null,
      }),
    );
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }] }),
    });

    await notifyAccountDevicesOfIncomingMessage({
      accountId: "acc-1",
      conversationId: "conv-9",
      contactName: "Ada",
      contentType: "text",
      contentText: "hi",
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXPO_PUSH_URL);
    const body = JSON.parse(String(init.body));
    expect(body).toEqual([
      {
        to: "ExponentPushToken[aaa]",
        title: "New message from Ada",
        body: "hi",
        sound: "incoming.wav",
        channelId: "incoming-messages",
        priority: "high",
        data: { conversationId: "conv-9" },
      },
    ]);
  });
});
