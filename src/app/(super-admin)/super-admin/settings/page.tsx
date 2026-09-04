"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type Source = "database" | "env" | "none";

type SettingsPayload = {
  razorpay_key_id: string;
  has_razorpay_secret: boolean;
  has_razorpay_webhook_secret: boolean;
  configured: boolean;
  source: Source;
  mode: "test" | "live" | null;
  active_key_id: string;
  unsynced_paid_count: number;
};

export default function SuperAdminSettingsPage() {
  const t = useTranslations("SuperAdmin.settings");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [payload, setPayload] = useState<SettingsPayload | null>(null);
  const [keyId, setKeyId] = useState("");
  const [secret, setSecret] = useState("");
  const [secretEdited, setSecretEdited] = useState(false);
  const [clearSecret, setClearSecret] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookEdited, setWebhookEdited] = useState(false);
  const [clearWebhook, setClearWebhook] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = origin ? `${origin}/api/billing/razorpay/webhook` : "";

  const apply = useCallback((d: SettingsPayload) => {
    setPayload(d);
    setKeyId(d.razorpay_key_id ?? "");
    setSecret("");
    setSecretEdited(false);
    setClearSecret(false);
    setWebhookSecret("");
    setWebhookEdited(false);
    setClearWebhook(false);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/super-admin/settings");
    const d = (await res.json().catch(() => ({}))) as SettingsPayload & {
      error?: string;
    };
    if (!res.ok) {
      toast.error(d.error ?? t("loadFailed"));
      return false;
    }
    apply(d);
    return true;
  }, [apply, t]);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/super-admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razorpay_key_id: keyId,
          razorpay_key_secret: clearSecret ? null : secretEdited ? secret : undefined,
          razorpay_webhook_secret: clearWebhook
            ? null
            : webhookEdited
              ? webhookSecret
              : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as SettingsPayload & {
        error?: string;
      };
      if (!res.ok) {
        toast.error(data.error ?? t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      apply(data);
    } finally {
      setSaving(false);
    }
  }

  async function syncPlans() {
    setSyncing(true);
    try {
      const res = await fetch("/api/super-admin/settings", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        synced?: number;
        failed?: number;
        unsynced_paid_count?: number;
      };
      if (!res.ok) {
        toast.error(data.error ?? t("syncFailed"));
        return;
      }
      if ((data.failed ?? 0) > 0) {
        toast.error(t("syncPartial", { synced: data.synced ?? 0, failed: data.failed ?? 0 }));
      } else {
        toast.success(t("syncDone", { count: data.synced ?? 0 }));
      }
      await load();
    } finally {
      setSyncing(false);
    }
  }

  async function copyWebhook() {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    toast.success(t("copied"));
  }

  if (loading) return <p className="text-muted-foreground">{t("loading")}</p>;

  const source = payload?.source ?? "none";
  const mode = payload?.mode;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{t("gatewayTitle")}</CardTitle>
              <CardDescription>{t("gatewayDesc")}</CardDescription>
            </div>
            <StatusBadge
              configured={Boolean(payload?.configured)}
              source={source}
              mode={mode}
              configuredLabel={t("statusConfigured")}
              envLabel={t("statusEnv")}
              missingLabel={t("statusMissing")}
              testLabel={t("modeTest")}
              liveLabel={t("modeLive")}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("notShopifyHint")}</p>
          {source === "env" ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              {t("envFallback", { key: payload?.active_key_id || "—" })}
            </p>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="rzp-key-id">{t("keyId")}</Label>
            <Input
              id="rzp-key-id"
              value={keyId}
              onChange={(e) => setKeyId(e.target.value)}
              placeholder="rzp_live_… or rzp_test_…"
              autoComplete="off"
            />
          </div>

          <SecretField
            id="rzp-secret"
            label={t("keySecret")}
            saved={Boolean(payload?.has_razorpay_secret)}
            pendingClear={clearSecret}
            value={secret}
            savedLabel={t("savedStatus")}
            notSetLabel={t("notSet")}
            willClearLabel={t("willClear")}
            keepPlaceholder={t("keepPlaceholder")}
            pastePlaceholder={t("pastePlaceholder")}
            clearLabel={t("clear")}
            onChange={(v) => {
              setSecret(v);
              setSecretEdited(true);
              setClearSecret(false);
            }}
            onClear={() => {
              setSecret("");
              setSecretEdited(false);
              setClearSecret(true);
            }}
          />

          <SecretField
            id="rzp-webhook"
            label={t("webhookSecret")}
            saved={Boolean(payload?.has_razorpay_webhook_secret)}
            pendingClear={clearWebhook}
            value={webhookSecret}
            savedLabel={t("savedStatus")}
            notSetLabel={t("notSet")}
            willClearLabel={t("willClear")}
            keepPlaceholder={t("keepPlaceholder")}
            pastePlaceholder={t("pastePlaceholder")}
            clearLabel={t("clear")}
            onChange={(v) => {
              setWebhookSecret(v);
              setWebhookEdited(true);
              setClearWebhook(false);
            }}
            onClear={() => {
              setWebhookSecret("");
              setWebhookEdited(false);
              setClearWebhook(true);
            }}
          />

          <div className="space-y-2">
            <Label>{t("webhookUrl")}</Label>
            <div className="flex gap-2">
              <Input readOnly value={webhookUrl} />
              <Button type="button" variant="outline" onClick={() => void copyWebhook()}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("webhookHint")}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? t("saving") : t("save")}
            </Button>
            {payload?.configured && (payload.unsynced_paid_count ?? 0) > 0 ? (
              <Button
                type="button"
                variant="outline"
                disabled={syncing}
                onClick={() => void syncPlans()}
              >
                {syncing
                  ? t("syncing")
                  : t("syncPlans", { count: payload.unsynced_paid_count })}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({
  configured,
  source,
  mode,
  configuredLabel,
  envLabel,
  missingLabel,
  testLabel,
  liveLabel,
}: {
  configured: boolean;
  source: Source;
  mode: "test" | "live" | null;
  configuredLabel: string;
  envLabel: string;
  missingLabel: string;
  testLabel: string;
  liveLabel: string;
}) {
  if (!configured) return <Badge variant="secondary">{missingLabel}</Badge>;
  const label = source === "env" ? envLabel : configuredLabel;
  return (
    <div className="flex flex-wrap gap-1">
      <Badge>{label}</Badge>
      {mode ? <Badge variant="outline">{mode === "test" ? testLabel : liveLabel}</Badge> : null}
    </div>
  );
}

function SecretField({
  id,
  label,
  value,
  saved,
  pendingClear,
  savedLabel,
  notSetLabel,
  willClearLabel,
  keepPlaceholder,
  pastePlaceholder,
  clearLabel,
  onChange,
  onClear,
}: {
  id: string;
  label: string;
  value: string;
  saved: boolean;
  pendingClear: boolean;
  savedLabel: string;
  notSetLabel: string;
  willClearLabel: string;
  keepPlaceholder: string;
  pastePlaceholder: string;
  clearLabel: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const status = pendingClear ? willClearLabel : saved ? savedLabel : notSetLabel;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>
          {label}{" "}
          <span className="font-normal text-muted-foreground">({status})</span>
        </Label>
        {saved && !pendingClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            {clearLabel}
          </Button>
        ) : null}
      </div>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={saved && !pendingClear ? keepPlaceholder : pastePlaceholder}
        autoComplete="off"
        disabled={pendingClear}
      />
    </div>
  );
}
