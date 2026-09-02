"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  formatSessionCountdown,
  sessionWindowMsLeft,
  sessionWindowUrgency,
  type SessionWindowUrgency,
} from "@/lib/inbox/session-window";

const URGENCY_CLASS: Record<SessionWindowUrgency, string> = {
  ok: "text-primary",
  soon: "text-amber-500",
  urgent: "text-orange-500",
  expired: "text-red-400",
};

interface SessionWindowBadgeProps {
  expiresAt: Date | null;
  hasCustomerMessage: boolean;
}

export function SessionWindowBadge({
  expiresAt,
  hasCustomerMessage,
}: SessionWindowBadgeProps) {
  const t = useTranslations("Inbox.sessionTimer");
  const [now, setNow] = useState(() => Date.now());

  const msLeft = sessionWindowMsLeft(expiresAt, now);
  const ticking = hasCustomerMessage && msLeft > 0;

  useEffect(() => {
    if (!ticking) return;
    let id: ReturnType<typeof setTimeout>;
    const schedule = () => {
      id = setTimeout(() => {
        setNow(Date.now());
        schedule();
      }, 1000 - (Date.now() % 1000));
    };
    schedule();
    return () => clearTimeout(id);
  }, [ticking, expiresAt]);

  if (!hasCustomerMessage) {
    return (
      <Badge
        variant="outline"
        className="ml-1 inline-flex gap-1 border-border text-[10px] text-red-400 sm:ml-2"
      >
        <Clock className="h-3 w-3" />
        {t("noCustomerMessages")}
      </Badge>
    );
  }

  const countdown = formatSessionCountdown(msLeft);
  const urgency = sessionWindowUrgency(msLeft);
  const closeTime = expiresAt ? format(expiresAt, "p") : "";
  const label = urgency === "expired" ? t("expired") : countdown.label;
  const ariaLabel =
    urgency === "expired"
      ? t("expired")
      : t("remainingAria", { hours: countdown.hours, minutes: countdown.minutes });

  return (
    <Badge
      variant="outline"
      title={closeTime ? t("closesAt", { time: closeTime }) : undefined}
      aria-label={ariaLabel}
      className={cn(
        "ml-1 inline-flex gap-1 border-border text-[10px] sm:ml-2",
        URGENCY_CLASS[urgency],
      )}
    >
      <Clock className={cn("h-3 w-3", urgency === "urgent" && "animate-pulse")} />
      <span className="inline-block min-w-[8ch] text-center tabular-nums">{label}</span>
    </Badge>
  );
}
