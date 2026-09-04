"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Phone } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS: { href: string; labelKey: string }[] = [
  { href: "/calling", labelKey: "callingAnalytics" },
  { href: "/calling/settings", labelKey: "callingSettings" },
  { href: "/calling/recording", labelKey: "callingRecording" },
  { href: "/calling/transcription", labelKey: "callingTranscription" },
  { href: "/calling/ai", labelKey: "callingAi" },
  { href: "/calling/live-ai", labelKey: "callingLiveAi" },
  { href: "/calling/forwarding", labelKey: "callingForwarding" },
];

function tabIsActive(pathname: string, href: string): boolean {
  if (href === "/calling") return pathname === "/calling";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function CallingNav() {
  const t = useTranslations("Calling");
  const ts = useTranslations("Sidebar");
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      inline: "center",
      block: "nearest",
      behavior: "smooth",
    });
  }, [pathname]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <Phone className="mt-0.5 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {t("sectionTitle")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("sectionDesc")}</p>
        </div>
      </div>

      <nav
        aria-label={t("sectionTitle")}
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-border px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const active = tabIsActive(pathname, tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              ref={active ? activeRef : undefined}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative shrink-0 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                active
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {ts(tab.labelKey)}
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-2 -bottom-px h-0.5 rounded-full",
                  active ? "bg-foreground" : "bg-transparent",
                )}
              />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
