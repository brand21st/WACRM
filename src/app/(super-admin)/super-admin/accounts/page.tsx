"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AccountStatusSelect } from "@/components/super-admin/account-status-select";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatPlanDate,
  isAccountStatus,
  type PlatformAccountStatus,
} from "@/lib/auth/account-status";

interface Row {
  id: string;
  name: string;
  status: string;
  owner_email: string | null;
  members: number;
  whatsapp_connected: boolean;
  shopify_connected: boolean;
  package_name: string | null;
  subscription_status: string | null;
  period_start: string | null;
  period_end: string | null;
  tokens_30d: number;
}

export default function SuperAdminAccountsPage() {
  const t = useTranslations("SuperAdmin.accountsPage");
  const statusT = useTranslations("SuperAdmin.account");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    const timer = setTimeout(() => {
      void fetch(`/api/super-admin/accounts?${params}`)
        .then((r) => r.json())
        .then((d) => setRows(d.accounts ?? []));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, status]);

  const statusLabels = {
    active: statusT("statusActive"),
    hold: statusT("statusHold"),
    block: statusT("statusBlock"),
  };

  async function changeStatus(id: string, next: PlatformAccountStatus) {
    const previous = rows;
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, status: next } : row)),
    );
    setPendingId(id);
    const res = await fetch(`/api/super-admin/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setPendingId(null);
    if (!res.ok) {
      setRows(previous);
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? t("statusFailed"));
      return;
    }
    toast.success(statusT("saved"));
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <Input
          placeholder={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Select value={status} onValueChange={(v) => { if (v) setStatus(v); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            <SelectItem value="active">{statusT("statusActive")}</SelectItem>
            <SelectItem value="hold">{statusT("statusHold")}</SelectItem>
            <SelectItem value="suspended">{statusT("statusBlock")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("account")}</th>
              <th className="px-3 py-2 font-medium">{t("owner")}</th>
              <th className="px-3 py-2 font-medium">{t("plan")}</th>
              <th className="px-3 py-2 font-medium">{statusT("periodStart")}</th>
              <th className="px-3 py-2 font-medium">{statusT("periodEnd")}</th>
              <th className="px-3 py-2 font-medium">{t("members")}</th>
              <th className="px-3 py-2 font-medium">{t("wa")}</th>
              <th className="px-3 py-2 font-medium">{t("shopify")}</th>
              <th className="px-3 py-2 font-medium">{statusT("accountStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <Link href={`/super-admin/accounts/${row.id}`} className="text-primary hover:underline">
                    {row.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.owner_email ?? "—"}</td>
                <td className="px-3 py-2">{row.package_name ?? "—"}</td>
                <td className="px-3 py-2">{formatPlanDate(row.period_start)}</td>
                <td className="px-3 py-2">{formatPlanDate(row.period_end)}</td>
                <td className="px-3 py-2">{row.members}</td>
                <td className="px-3 py-2">{row.whatsapp_connected ? t("on") : "—"}</td>
                <td className="px-3 py-2">{row.shopify_connected ? t("on") : "—"}</td>
                <td className="px-3 py-2">
                  <AccountStatusSelect
                    value={isAccountStatus(row.status) ? row.status : "active"}
                    disabled={pendingId === row.id}
                    labels={statusLabels}
                    onChange={(next) => void changeStatus(row.id, next)}
                  />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
