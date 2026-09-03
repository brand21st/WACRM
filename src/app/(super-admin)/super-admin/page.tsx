"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Overview {
  accounts: number;
  suspended: number;
  ai_configured: boolean;
  global_ai_enabled: boolean;
  active_subscriptions: number;
  mrr_paise: number;
  tokens_this_month: number;
}

function inr(paise: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(paise / 100);
}

export default function SuperAdminOverviewPage() {
  const t = useTranslations("SuperAdmin.overview");
  const [data, setData] = useState<Overview | null>(null);

  useEffect(() => {
    void fetch("/api/super-admin/overview")
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, []);

  const cards = [
    { label: t("accounts"), value: data?.accounts ?? "—" },
    { label: t("suspended"), value: data?.suspended ?? "—" },
    { label: t("activeSubs"), value: data?.active_subscriptions ?? "—" },
    { label: t("mrr"), value: data ? inr(data.mrr_paise) : "—" },
    { label: t("aiConfigured"), value: data?.ai_configured ? "Yes" : "No" },
    { label: t("tokens"), value: data?.tokens_this_month ?? "—" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
