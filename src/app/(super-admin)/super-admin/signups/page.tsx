"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BarChart } from "@/components/tremor/bar-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatPlanDate } from "@/lib/auth/account-status";
import type { SignupGrain, SignupSort } from "@/lib/super-admin/signup-buckets";

const CHART_CATEGORY = "Signups";

interface SignupRow {
  id: string;
  name: string;
  created_at: string;
  owner_email: string | null;
  owner_name: string | null;
  package_name: string | null;
  subscription_status: string | null;
  period_end: string | null;
  active: boolean;
}

interface SignupsPayload {
  totals: { signups: number; active: number; inactive: number };
  buckets: Array<{ label: string; count: number }>;
  rows: SignupRow[];
}

export default function SuperAdminSignupsPage() {
  const t = useTranslations("SuperAdmin.signupsPage");
  const [q, setQ] = useState("");
  const [grain, setGrain] = useState<SignupGrain>("day");
  const [sort, setSort] = useState<SignupSort>("newest");
  const [data, setData] = useState<SignupsPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("grain", grain);
    params.set("sort", sort);
    if (q) params.set("q", q);
    const timer = setTimeout(() => {
      void fetch(`/api/super-admin/signups?${params}`)
        .then((r) => {
          if (!r.ok) throw new Error("failed");
          return r.json();
        })
        .then((payload: SignupsPayload) => {
          setData(payload);
          setFailed(false);
        })
        .catch(() => {
          setData(null);
          setFailed(true);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [q, grain, sort]);

  const chartHint =
    grain === "month" ? t("chartMonth") : grain === "year" ? t("chartYear") : t("chartDay");

  const chartData =
    data?.buckets.map((b) => ({
      label: b.label,
      [CHART_CATEGORY]: b.count,
    })) ?? [];

  const cards = [
    { label: t("total"), value: data?.totals.signups ?? "—" },
    { label: t("active"), value: data?.totals.active ?? "—" },
    { label: t("inactive"), value: data?.totals.inactive ?? "—" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>

      <div className="mt-4 flex flex-wrap gap-3">
        <Input
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Select
          value={grain}
          onValueChange={(v) => {
            if (v === "day" || v === "month" || v === "year") setGrain(v);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">{t("grainDay")}</SelectItem>
            <SelectItem value="month">{t("grainMonth")}</SelectItem>
            <SelectItem value="year">{t("grainYear")}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(v) => {
            if (v === "newest" || v === "oldest") setSort(v);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">{t("sortNewest")}</SelectItem>
            <SelectItem value="oldest">{t("sortOldest")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-border bg-card">
        <header className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t("chartTitle")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{chartHint}</p>
        </header>
        <div className="p-5">
          <BarChart
            data={chartData}
            index="label"
            categories={[CHART_CATEGORY]}
            colors={["emerald"]}
            valueFormatter={(value) => String(value)}
            showLegend={false}
            allowDecimals={false}
            yAxisWidth={36}
            className="h-[220px]"
          />
        </div>
      </section>

      {failed ? (
        <p className="mt-4 text-sm text-destructive">{t("loadFailed")}</p>
      ) : null}

      <div className="mt-6 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("signedUp")}</th>
              <th className="px-3 py-2 font-medium">{t("account")}</th>
              <th className="px-3 py-2 font-medium">{t("owner")}</th>
              <th className="px-3 py-2 font-medium">{t("plan")}</th>
              <th className="px-3 py-2 font-medium">{t("subscription")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2 tabular-nums">{formatPlanDate(row.created_at)}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/super-admin/accounts/${row.id}`}
                    className="text-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.owner_email ?? row.owner_name ?? "—"}
                </td>
                <td className="px-3 py-2">{row.package_name ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      row.active
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                    }
                  >
                    {row.active ? t("activeBadge") : t("inactiveBadge")}
                  </span>
                </td>
              </tr>
            ))}
            {!data?.rows.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  {failed ? t("loadFailed") : t("empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
