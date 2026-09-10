import { describe, expect, it } from "vitest";
import {
  CONTACT_AVATAR_PALETTE,
  contactAvatarColor,
  contactInitials,
  isHttpsUrl,
} from "./avatar";

describe("contactInitials", () => {
  it("takes first + last word letters for two-word names", () => {
    expect(contactInitials("Gokul Kumar")).toBe("GK");
    expect(contactInitials("Mary Kate")).toBe("MK");
  });

  it("uses first and last words when there are more than two", () => {
    expect(contactInitials("Mary Kate Smith")).toBe("MS");
  });

  it("uses the first two letters of a one-word name", () => {
    expect(contactInitials("Suresh")).toBe("SU");
  });

  it("falls back to the first two phone digits when there is no name", () => {
    expect(contactInitials(null, "+15551234567")).toBe("15");
    expect(contactInitials("   ", "+44 7911 123456")).toBe("44");
  });

  it("returns ? when both name and phone are empty", () => {
    expect(contactInitials(null, null)).toBe("?");
    expect(contactInitials("", "")).toBe("?");
  });

  it("skips punctuation when picking letters", () => {
    expect(contactInitials("'Gokul' Kumar")).toBe("GK");
  });
});

describe("contactAvatarColor", () => {
  it("is deterministic for the same seed", () => {
    expect(contactAvatarColor("contact-1")).toEqual(
      contactAvatarColor("contact-1"),
    );
  });

  it("picks from the palette", () => {
    const color = contactAvatarColor("abc");
    expect(CONTACT_AVATAR_PALETTE).toContainEqual(color);
  });

  it("can differ across seeds", () => {
    const a = contactAvatarColor("contact-aaa");
    const b = contactAvatarColor("contact-zzz");
    expect(a.bg !== b.bg || a === b).toBe(true);
  });
});

describe("isHttpsUrl", () => {
  it("accepts https URLs", () => {
    expect(isHttpsUrl("https://cdn.example.com/a.png")).toBe(true);
  });

  it("rejects http and junk", () => {
    expect(isHttpsUrl("http://cdn.example.com/a.png")).toBe(false);
    expect(isHttpsUrl("not-a-url")).toBe(false);
  });
});
