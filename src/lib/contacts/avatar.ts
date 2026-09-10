import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Two-letter contact initials and a stable per-contact color for
 * fallback avatars (inbox list, thread header, sidebar, contacts).
 *
 * WhatsApp Cloud API never sends a customer DP, so this is what we
 * show until an agent uploads or pastes a photo onto `contacts.avatar_url`.
 */

export const CONTACT_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const CONTACT_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

/** Saturated fills that stay readable with white initials in both themes. */
export const CONTACT_AVATAR_PALETTE = [
  { bg: "#C0392B", fg: "#FFFFFF" },
  { bg: "#D35400", fg: "#FFFFFF" },
  { bg: "#B9770E", fg: "#FFFFFF" },
  { bg: "#1E8449", fg: "#FFFFFF" },
  { bg: "#148F77", fg: "#FFFFFF" },
  { bg: "#1A5276", fg: "#FFFFFF" },
  { bg: "#2471A3", fg: "#FFFFFF" },
  { bg: "#6C3483", fg: "#FFFFFF" },
  { bg: "#884EA0", fg: "#FFFFFF" },
  { bg: "#A93226", fg: "#FFFFFF" },
  { bg: "#117A65", fg: "#FFFFFF" },
  { bg: "#1F618D", fg: "#FFFFFF" },
] as const;

const LETTER_OR_DIGIT = /\p{L}|\p{N}/u;

function firstAlnumChar(value: string): string {
  for (const ch of value) {
    if (LETTER_OR_DIGIT.test(ch)) return ch;
  }
  return "";
}

function firstTwoAlnum(value: string): string {
  let out = "";
  for (const ch of value) {
    if (LETTER_OR_DIGIT.test(ch)) {
      out += ch;
      if (out.length === 2) break;
    }
  }
  return out;
}

/**
 * `Gokul Kumar` → `GK`, `Mary Kate` → `MK`, `Suresh` → `SU`.
 * No name → first two alphanumerics of the phone, else `?`.
 */
export function contactInitials(
  name?: string | null,
  phone?: string | null,
): string {
  const trimmed = name?.trim() ?? "";
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const a = firstAlnumChar(words[0]);
      const b = firstAlnumChar(words[words.length - 1]);
      const pair = (a + b).toUpperCase();
      if (pair.length === 2) return pair;
    }
    const two = firstTwoAlnum(trimmed).toUpperCase();
    if (two) return two;
  }
  const fromPhone = firstTwoAlnum(phone ?? "").toUpperCase();
  return fromPhone || "?";
}

export function contactAvatarColor(seed: string): {
  bg: string;
  fg: string;
} {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % CONTACT_AVATAR_PALETTE.length;
  return CONTACT_AVATAR_PALETTE[index];
}

export function isAllowedAvatarFile(file: File): "ok" | "type" | "size" {
  if (!CONTACT_AVATAR_MIMES.has(file.type)) return "type";
  if (file.size > CONTACT_AVATAR_MAX_BYTES) return "size";
  return "ok";
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function uploadContactAvatar(args: {
  supabase: SupabaseClient;
  userId: string;
  contactId: string;
  file: File;
}): Promise<string> {
  const { supabase, userId, contactId, file } = args;
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${userId}/contacts/${contactId}/avatar-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type,
  });
  if (error) {
    throw new Error(error.message);
  }
  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);
  return publicUrl;
}

export async function persistContactAvatarUrl(args: {
  supabase: SupabaseClient;
  contactId: string;
  avatarUrl: string | null;
}): Promise<void> {
  const { supabase, contactId, avatarUrl } = args;
  const { error } = await supabase
    .from("contacts")
    .update({
      avatar_url: avatarUrl,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contactId);
  if (error) {
    throw new Error(error.message);
  }
}
