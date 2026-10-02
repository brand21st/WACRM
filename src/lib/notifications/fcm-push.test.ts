import { describe, expect, it } from "vitest";

import { isFcmToken } from "./fcm-push";

describe("isFcmToken", () => {
  it("accepts long FCM registration tokens", () => {
    const token = `d${"A".repeat(140)}:APA91b${"B".repeat(40)}`;
    expect(isFcmToken(token)).toBe(true);
  });

  it("rejects Expo tokens and junk", () => {
    expect(isFcmToken("ExponentPushToken[abc123]")).toBe(false);
    expect(isFcmToken("short")).toBe(false);
  });
});
