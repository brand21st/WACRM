import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { authMetadataAvatarUrl, resolveUserAvatarUrl } from "./user-avatar";

function userWithMeta(meta: Record<string, unknown>): User {
  return { user_metadata: meta } as User;
}

describe("authMetadataAvatarUrl", () => {
  it("prefers avatar_url", () => {
    expect(
      authMetadataAvatarUrl(
        userWithMeta({
          avatar_url: "https://cdn.example.com/a.png",
          picture: "https://cdn.example.com/b.png",
        }),
      ),
    ).toBe("https://cdn.example.com/a.png");
  });

  it("falls back to picture", () => {
    expect(
      authMetadataAvatarUrl(userWithMeta({ picture: "https://lh3.google.com/a" })),
    ).toBe("https://lh3.google.com/a");
  });

  it("ignores non-http values", () => {
    expect(authMetadataAvatarUrl(userWithMeta({ avatar_url: "not-a-url" }))).toBe(
      null,
    );
  });
});

describe("resolveUserAvatarUrl", () => {
  it("uses the profile photo first", () => {
    expect(
      resolveUserAvatarUrl(
        "https://app.example.com/me.png",
        userWithMeta({ picture: "https://lh3.google.com/a" }),
      ),
    ).toBe("https://app.example.com/me.png");
  });

  it("uses auth metadata when the profile has no photo", () => {
    expect(
      resolveUserAvatarUrl(null, userWithMeta({ picture: "https://lh3.google.com/a" })),
    ).toBe("https://lh3.google.com/a");
  });
});
