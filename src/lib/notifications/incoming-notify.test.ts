import { describe, expect, it } from "vitest";
import {
  shouldNotifyIncoming,
  viewingConversationIdFromLocation,
} from "./incoming-notify";
import { parseIncomingAlertPrefs } from "./incoming-prefs";

const base = {
  senderType: "customer",
  conversationId: "conv-1",
  messageId: "msg-1",
  viewingConversationId: null as string | null,
  documentHidden: false,
  alreadySeen: false,
};

describe("shouldNotifyIncoming", () => {
  it("alerts on a new inbound customer message", () => {
    expect(shouldNotifyIncoming(base)).toEqual({
      sound: true,
      toast: true,
      desktop: false,
    });
  });

  it("uses a desktop notification only when the tab is hidden", () => {
    expect(shouldNotifyIncoming({ ...base, documentHidden: true })).toEqual({
      sound: true,
      toast: true,
      desktop: true,
    });
  });

  it("skips when the agent is looking at that thread", () => {
    expect(
      shouldNotifyIncoming({
        ...base,
        viewingConversationId: "conv-1",
        documentHidden: false,
      }),
    ).toEqual({ sound: false, toast: false, desktop: false });
  });

  it("still alerts if the thread is open but the tab is hidden", () => {
    expect(
      shouldNotifyIncoming({
        ...base,
        viewingConversationId: "conv-1",
        documentHidden: true,
      }),
    ).toEqual({ sound: true, toast: true, desktop: true });
  });

  it("ignores agent, bot, duplicate rows, and call bubbles", () => {
    expect(shouldNotifyIncoming({ ...base, senderType: "agent" }).sound).toBe(
      false,
    );
    expect(shouldNotifyIncoming({ ...base, senderType: "bot" }).sound).toBe(
      false,
    );
    expect(shouldNotifyIncoming({ ...base, alreadySeen: true }).sound).toBe(
      false,
    );
    expect(shouldNotifyIncoming({ ...base, contentType: "call" }).sound).toBe(
      false,
    );
  });
});

describe("viewingConversationIdFromLocation", () => {
  it("reads ?c= only on /inbox", () => {
    expect(viewingConversationIdFromLocation("/inbox", "?c=abc")).toBe("abc");
    expect(viewingConversationIdFromLocation("/inbox", "c=abc")).toBe("abc");
    expect(viewingConversationIdFromLocation("/contacts", "?c=abc")).toBeNull();
    expect(viewingConversationIdFromLocation("/inbox", "")).toBeNull();
  });
});

describe("parseIncomingAlertPrefs", () => {
  it("defaults both flags on, and ignores junk", () => {
    expect(parseIncomingAlertPrefs(null)).toEqual({
      sound: true,
      desktop: true,
    });
    expect(parseIncomingAlertPrefs("{nope")).toEqual({
      sound: true,
      desktop: true,
    });
    expect(parseIncomingAlertPrefs('{"sound":false}')).toEqual({
      sound: false,
      desktop: true,
    });
  });
});
