"use client";

import type { User } from "@supabase/supabase-js";

import { ContactAvatar, type ContactAvatarSize } from "@/components/contacts/contact-avatar";
import { resolveUserAvatarUrl } from "@/lib/auth/user-avatar";

/** Same-origin proxy — Meta's WhatsApp CDN URL is not embeddable. */
const BUSINESS_AVATAR_SRC = "/api/whatsapp/business-avatar?proxy=1";

export function UserAvatar({
  profileId,
  name,
  email,
  avatarUrl,
  user,
  size = "xs",
  className,
}: {
  profileId?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  user?: User | null;
  size?: ContactAvatarSize;
  className?: string;
}) {
  const stored = resolveUserAvatarUrl(avatarUrl, user);

  return (
    <ContactAvatar
      contactId={profileId}
      name={name}
      phone={email}
      avatarUrl={stored ?? BUSINESS_AVATAR_SRC}
      size={size}
      className={className}
    />
  );
}
