import { cn } from "@/lib/utils";
import type { ChannelType } from "@/types";

const LABELS: Record<ChannelType, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  messenger: "Messenger",
};

export function ChannelBadge({
  channel = "whatsapp",
  className,
}: {
  channel?: ChannelType | null;
  className?: string;
}) {
  const key = channel ?? "whatsapp";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
        key === "whatsapp" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        key === "instagram" && "bg-pink-500/15 text-pink-600 dark:text-pink-400",
        key === "messenger" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
        className,
      )}
    >
      {LABELS[key]}
    </span>
  );
}

export function channelDisplayName(
  contact: {
    name?: string | null;
    phone?: string | null;
    channel?: ChannelType | null;
    channel_user_id?: string | null;
  } | null,
  fallback = "Customer",
): string {
  if (contact?.name?.trim()) return contact.name.trim();
  if (contact?.phone) return contact.phone;
  return fallback;
}
