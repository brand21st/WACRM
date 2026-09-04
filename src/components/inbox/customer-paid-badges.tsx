"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface CustomerPaidBadgesProps {
  waCommercePaidAt?: string | null;
  shopifyPaidAt?: string | null;
  className?: string;
}

export function CustomerPaidBadges({
  waCommercePaidAt,
  shopifyPaidAt,
  className,
}: CustomerPaidBadgesProps) {
  const t = useTranslations("Inbox.paidLabels");
  const waPaid = Boolean(waCommercePaidAt);
  const shopifyPaid = Boolean(shopifyPaidAt);
  if (!waPaid && !shopifyPaid) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {waPaid && (
        <Badge
          variant="outline"
          className="border-emerald-500/40 bg-emerald-500/10 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
        >
          {t("whatsappPaid")}
        </Badge>
      )}
      {shopifyPaid && (
        <Badge
          variant="outline"
          className="border-indigo-500/40 bg-indigo-500/10 text-[10px] font-medium text-indigo-700 dark:text-indigo-400"
        >
          {t("shopifyPaid")}
        </Badge>
      )}
    </span>
  );
}
