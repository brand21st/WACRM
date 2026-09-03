"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Detail {
  account: {
    id: string;
    name: string;
    status: string;
    ai_enabled: boolean;
    created_at: string;
    default_currency?: string | null;
  };
  owner: {
    user_id: string;
    full_name: string | null;
    email: string;
    avatar_url: string | null;
  } | null;
  members: Array<{
    user_id: string;
    full_name: string | null;
    email: string;
    account_role: string;
    avatar_url?: string | null;
  }>;
  whatsapp: { phone_number_id: string; waba_id: string | null; status: string; has_token: boolean } | null;
  shopify: { shop_domain: string; shop_name: string | null; is_active: boolean; has_token: boolean } | null;
  subscription: {
    status: string;
    source: string;
    package_id: string;
    package_name: string | null;
    current_period_end: string | null;
  } | null;
  tokens_this_month: number;
  billing_events?: Array<{
    id: string;
    event_type: string;
    processed_at: string;
  }>;
}

interface Pkg {
  id: string;
  name: string;
}

function initials(name: string | null | undefined, email: string | null | undefined) {
  const source = (name || email || "?").trim();
  return source.slice(0, 2).toUpperCase();
}

export default function SuperAdminAccountDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("SuperAdmin.account");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [name, setName] = useState("");
  const [waPhone, setWaPhone] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waWaba, setWaWaba] = useState("");
  const [shopDomain, setShopDomain] = useState("");
  const [shopToken, setShopToken] = useState("");
  const [packageId, setPackageId] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/super-admin/accounts/${id}`);
    const data = (await res.json()) as Detail;
    setDetail(data);
    setName(data.account?.name ?? "");
    setWaPhone(data.whatsapp?.phone_number_id ?? "");
    setWaWaba(data.whatsapp?.waba_id ?? "");
    setShopDomain(data.shopify?.shop_domain ?? "");
    setPackageId(data.subscription?.package_id ?? "");
  }, [id]);

  useEffect(() => {
    void load();
    void fetch("/api/super-admin/billing/packages")
      .then((r) => r.json())
      .then((d) => setPackages(d.packages ?? []));
  }, [load]);

  if (!detail?.account) return <p className="text-muted-foreground">{t("loading")}</p>;

  const owner = detail.owner;
  const suspended = detail.account.status === "suspended";
  const waOn = detail.whatsapp?.status === "connected" || Boolean(detail.whatsapp?.has_token);
  const shopOn = Boolean(detail.shopify?.is_active || detail.shopify?.shop_domain);
  const selectedPkg = packages.find((p) => p.id === packageId);

  async function patch(body: Record<string, unknown>, ok = t("saved")) {
    const res = await fetch(`/api/super-admin/accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? t("failed"));
      return;
    }
    toast.success(ok);
    await load();
  }

  return (
    <div className="space-y-6">
      <Link
        href="/super-admin/accounts"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {t("backToAccounts")}
      </Link>

      <div className="flex flex-wrap items-start gap-4">
        <Avatar className="size-14">
          {owner?.avatar_url ? <AvatarImage src={owner.avatar_url} alt={owner.full_name ?? owner.email} /> : null}
          <AvatarFallback className="bg-primary/10 text-lg text-primary">
            {initials(owner?.full_name ?? detail.account.name, owner?.email)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{detail.account.name}</h1>
            <Badge variant={suspended ? "destructive" : "secondary"}>
              {suspended ? t("suspended") : t("active")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("owner")}: {owner?.full_name || owner?.email || t("none")}
            {owner?.full_name && owner.email ? ` · ${owner.email}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("created")}: {new Date(detail.account.created_at).toLocaleString()}
            {detail.account.default_currency
              ? ` · ${t("currency")}: ${detail.account.default_currency}`
              : ""}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(detail.account.id);
            toast.success(t("copied"));
          }}
        >
          <Copy className="mr-2 h-3.5 w-3.5" />
          {t("accountId")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("plan")} value={detail.subscription?.package_name ?? t("none")} hint={detail.subscription?.source ?? undefined} />
        <StatCard label={t("tokensThisMonth")} value={detail.tokens_this_month.toLocaleString()} />
        <StatCard label={t("membersCount")} value={String(detail.members.length)} />
        <StatCard
          label="WhatsApp / Shopify"
          value={`${waOn ? t("connected") : t("notConnected")} / ${shopOn ? t("connected") : t("notConnected")}`}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList variant="line">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="members">{t("tabMembers")}</TabsTrigger>
          <TabsTrigger value="whatsapp">{t("tabWhatsapp")}</TabsTrigger>
          <TabsTrigger value="shopify">{t("tabShopify")}</TabsTrigger>
          <TabsTrigger value="billing">{t("tabBilling")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("controls")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>{t("name")}</Label>
                <div className="flex gap-2">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                  <Button onClick={() => void patch({ name })}>{t("rename")}</Button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{t("suspended")}</p>
                  <p className="text-xs text-muted-foreground">{t("suspendedHint")}</p>
                </div>
                <Switch
                  checked={suspended}
                  onCheckedChange={(on) => void patch({ status: on ? "suspended" : "active" })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">{t("aiEnabled")}</p>
                  <p className="text-xs text-muted-foreground">{t("aiEnabledHint")}</p>
                </div>
                <Switch
                  checked={detail.account.ai_enabled}
                  onCheckedChange={(on) => void patch({ ai_enabled: on })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("assignPackage")}</Label>
                <div className="flex gap-2">
                  <Select value={packageId} onValueChange={(v) => { if (v) setPackageId(v) }}>
                    <SelectTrigger className="max-w-sm">
                      <SelectValue placeholder={t("package")}>
                        {selectedPkg?.name ?? t("package")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {packages.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button onClick={() => void patch({ package_id: packageId }, t("packageAssigned"))}>
                    {t("assign")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("currentPackage")}: {detail.subscription?.package_name ?? t("none")} (
                  {detail.subscription?.source ?? "—"})
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tabMembers")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.members.map((m) => (
                <div key={m.user_id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <div className="flex items-center gap-3">
                    <Avatar className="size-8">
                      {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={m.full_name ?? m.email} /> : null}
                      <AvatarFallback className="text-xs">
                        {initials(m.full_name, m.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm">{m.full_name || m.email}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {m.account_role === "owner" ? (
                      <span className="text-xs text-muted-foreground">{m.account_role}</span>
                    ) : (
                      <Select
                        value={m.account_role}
                        onValueChange={async (role) => {
                          if (!role) return;
                          const res = await fetch(
                            `/api/super-admin/accounts/${id}/members/${m.user_id}`,
                            {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ role }),
                            },
                          );
                          if (!res.ok) toast.error(t("failed"));
                          else {
                            toast.success(t("saved"));
                            await load();
                          }
                        }}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">admin</SelectItem>
                          <SelectItem value="agent">agent</SelectItem>
                          <SelectItem value="viewer">viewer</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                    {m.account_role !== "owner" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          const res = await fetch(
                            `/api/super-admin/accounts/${id}/members/${m.user_id}`,
                            { method: "DELETE" },
                          );
                          if (!res.ok) toast.error(t("couldNotRemove"));
                          else {
                            toast.success(t("removed"));
                            await load();
                          }
                        }}
                      >
                        {t("remove")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="whatsapp" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tabWhatsapp")}</CardTitle>
              <CardDescription>
                {detail.whatsapp?.status === "connected" ? t("connected") : t("notConnected")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Phone number ID" value={waPhone} onChange={(e) => setWaPhone(e.target.value)} />
              <Input placeholder="WABA ID" value={waWaba} onChange={(e) => setWaWaba(e.target.value)} />
              <Input placeholder="Access token" value={waToken} onChange={(e) => setWaToken(e.target.value)} />
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    const res = await fetch(`/api/super-admin/accounts/${id}/whatsapp`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        phone_number_id: waPhone,
                        waba_id: waWaba,
                        access_token: waToken,
                      }),
                    });
                    if (!res.ok) toast.error((await res.json()).error ?? t("failed"));
                    else {
                      toast.success(t("whatsappSaved"));
                      setWaToken("");
                      await load();
                    }
                  }}
                >
                  {t("save")}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await fetch(`/api/super-admin/accounts/${id}/whatsapp`, { method: "DELETE" });
                    toast.success(t("disconnected"));
                    await load();
                  }}
                >
                  {t("disconnect")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="shopify" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tabShopify")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="shop.myshopify.com" value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} />
              <Input placeholder="Admin API token" value={shopToken} onChange={(e) => setShopToken(e.target.value)} />
              <div className="flex gap-2">
                <Button
                  onClick={async () => {
                    const res = await fetch(`/api/super-admin/accounts/${id}/shopify`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        shop_domain: shopDomain,
                        access_token: shopToken,
                      }),
                    });
                    if (!res.ok) toast.error((await res.json()).error ?? t("failed"));
                    else {
                      toast.success(t("shopifySaved"));
                      setShopToken("");
                      await load();
                    }
                  }}
                >
                  {t("save")}
                </Button>
                <Button
                  variant="outline"
                  onClick={async () => {
                    await fetch(`/api/super-admin/accounts/${id}/shopify`, { method: "DELETE" });
                    toast.success(t("disconnected"));
                    await load();
                  }}
                >
                  {t("disconnect")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tabBilling")}</CardTitle>
              <CardDescription>
                {detail.subscription
                  ? `${detail.subscription.package_name ?? t("none")} · ${detail.subscription.status}`
                  : t("none")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {t("periodEnd")}: {detail.subscription?.current_period_end ?? "—"}
              </p>
              {(detail.billing_events ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noEvents")}</p>
              ) : (
                <ul className="space-y-2">
                  {detail.billing_events!.map((event) => (
                    <li
                      key={event.id}
                      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span>{event.event_type}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(event.processed_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-lg font-semibold">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}
