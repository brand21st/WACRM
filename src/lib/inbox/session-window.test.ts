import { describe, expect, it } from "vitest";
import {
  CUSTOMER_SERVICE_WINDOW_MS,
  customerServiceExpiresAt,
  formatSessionCountdown,
  sessionWindowMsLeft,
  sessionWindowUrgency,
} from "./session-window";

describe("customerServiceExpiresAt", () => {
  it("adds 24 hours to an inbound timestamp", () => {
    const expires = customerServiceExpiresAt("2026-09-01T12:00:00.000Z");
    expect(expires?.toISOString()).toBe("2026-09-02T12:00:00.000Z");
  });

  it("returns null for missing or invalid input", () => {
    expect(customerServiceExpiresAt(null)).toBeNull();
    expect(customerServiceExpiresAt(undefined)).toBeNull();
    expect(customerServiceExpiresAt("not-a-date")).toBeNull();
  });
});

describe("formatSessionCountdown", () => {
  it("shows 24:00:00 at the start of the window", () => {
    expect(formatSessionCountdown(CUSTOMER_SERVICE_WINDOW_MS)).toEqual({
      hours: 24,
      minutes: 0,
      seconds: 0,
      label: "24:00:00",
    });
  });

  it("shows 23:00:00 after one hour", () => {
    expect(formatSessionCountdown(CUSTOMER_SERVICE_WINDOW_MS - 3_600_000).label).toBe(
      "23:00:00",
    );
  });

  it("shows 00:00:01 one second before expiry", () => {
    expect(formatSessionCountdown(1000).label).toBe("00:00:01");
  });

  it("clamps expired time to 00:00:00", () => {
    expect(formatSessionCountdown(0).label).toBe("00:00:00");
    expect(formatSessionCountdown(-5).label).toBe("00:00:00");
  });
});

describe("sessionWindowUrgency", () => {
  it("is ok with more than 4 hours left", () => {
    expect(sessionWindowUrgency(5 * 3_600_000)).toBe("ok");
  });

  it("is soon under 4 hours", () => {
    expect(sessionWindowUrgency(3 * 3_600_000)).toBe("soon");
  });

  it("is urgent under 1 hour", () => {
    expect(sessionWindowUrgency(30 * 60_000)).toBe("urgent");
  });

  it("is expired at or below zero", () => {
    expect(sessionWindowUrgency(0)).toBe("expired");
    expect(sessionWindowUrgency(-1)).toBe("expired");
  });
});

describe("sessionWindowMsLeft", () => {
  it("returns remaining milliseconds against a fixed now", () => {
    const expires = new Date("2026-09-02T12:00:00.000Z");
    const now = Date.parse("2026-09-02T11:00:00.000Z");
    expect(sessionWindowMsLeft(expires, now)).toBe(3_600_000);
  });

  it("returns 0 when there is no deadline", () => {
    expect(sessionWindowMsLeft(null)).toBe(0);
  });
});
