"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useIncomingAlertPrefs } from "@/hooks/use-incoming-alert-prefs";
import { unlockIncomingSound } from "@/lib/notifications/incoming-sound";
import { cn } from "@/lib/utils";

/**
 * Header mute for inbound-message chimes. Device-scoped; matches the
 * Appearance panel toggle.
 */
export function SoundToggle({ className }: { className?: string }) {
  const t = useTranslations("Header");
  const { prefs, setPrefs } = useIncomingAlertPrefs();
  const soundOn = prefs.sound;
  const label = soundOn ? t("muteSound") : t("unmuteSound");

  return (
    <button
      type="button"
      onClick={() => {
        unlockIncomingSound();
        setPrefs({ sound: !soundOn });
      }}
      aria-label={label}
      aria-pressed={soundOn}
      title={label}
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {soundOn ? (
        <Volume2 className="h-5 w-5" />
      ) : (
        <VolumeX className="h-5 w-5" />
      )}
    </button>
  );
}
