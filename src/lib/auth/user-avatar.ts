import type { User } from "@supabase/supabase-js";

/** OAuth / Supabase Auth picture, when the profiles row has none. */
export function authMetadataAvatarUrl(user: User | null | undefined): string | null {
  const meta = user?.user_metadata;
  if (!meta || typeof meta !== "object") return null;
  for (const key of ["avatar_url", "picture", "avatar"] as const) {
    const value = meta[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      return value;
    }
  }
  return null;
}

export function resolveUserAvatarUrl(
  profileAvatarUrl?: string | null,
  user?: User | null,
): string | null {
  if (profileAvatarUrl) return profileAvatarUrl;
  return authMetadataAvatarUrl(user);
}
