"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
  tokens_30d: number;
}

export default function SuperAdminAccountsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    const t = setTimeout(() => {
      void fetch(`/api/super-admin/accounts?${params}`)
        .then((r) => r.json())
        .then((d) => setRows(d.accounts ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [q, status]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Accounts</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <Input
          placeholder="Search name or email"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-sm"
        />
        <Select value={status} onValueChange={(v) => { if (v) setStatus(v) }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">Plan</th>
              <th className="px-3 py-2 font-medium">Members</th>
              <th className="px-3 py-2 font-medium">WA</th>
              <th className="px-3 py-2 font-medium">Shopify</th>
              <th className="px-3 py-2 font-medium">Status</th>
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
                <td className="px-3 py-2">{row.members}</td>
                <td className="px-3 py-2">{row.whatsapp_connected ? "On" : "—"}</td>
                <td className="px-3 py-2">{row.shopify_connected ? "On" : "—"}</td>
                <td className="px-3 py-2">{row.status}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  No accounts
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
