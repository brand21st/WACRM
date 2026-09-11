/**
 * Two-letter contact initials and a stable per-contact color for
 * fallback avatars. Matches the web inbox (`src/lib/contacts/avatar.ts`)
 * so the same contact keeps the same DP on both surfaces.
 */

export const CONTACT_AVATAR_PALETTE = [
  { bg: '#C0392B', fg: '#FFFFFF' },
  { bg: '#D35400', fg: '#FFFFFF' },
  { bg: '#B9770E', fg: '#FFFFFF' },
  { bg: '#1E8449', fg: '#FFFFFF' },
  { bg: '#148F77', fg: '#FFFFFF' },
  { bg: '#1A5276', fg: '#FFFFFF' },
  { bg: '#2471A3', fg: '#FFFFFF' },
  { bg: '#6C3483', fg: '#FFFFFF' },
  { bg: '#884EA0', fg: '#FFFFFF' },
  { bg: '#A93226', fg: '#FFFFFF' },
  { bg: '#117A65', fg: '#FFFFFF' },
  { bg: '#1F618D', fg: '#FFFFFF' },
] as const;

const LETTER_OR_DIGIT = /\p{L}|\p{N}/u;

function firstAlnumChar(value: string): string {
  for (const ch of value) {
    if (LETTER_OR_DIGIT.test(ch)) return ch;
  }
  return '';
}

function firstTwoAlnum(value: string): string {
  let out = '';
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
export function contactInitials(name?: string | null, phone?: string | null): string {
  const trimmed = name?.trim() ?? '';
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
  const fromPhone = firstTwoAlnum(phone ?? '').toUpperCase();
  return fromPhone || '?';
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
