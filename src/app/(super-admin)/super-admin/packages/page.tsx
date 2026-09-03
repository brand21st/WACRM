"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Package, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { intervalPriceSuffix } from "@/lib/billing/interval";
import type { BillingPackage } from "@/lib/billing/types";

type PackageRow = BillingPackage & { subscriberCount?: number };

function notifyPackagesChanged() {
  window.dispatchEvent(new Event("super-admin:packages-changed"));
}

const emptyForm = {
  name: "",
  description: "",
  interval: "month",
  amount_rupees: "",
  max_seats: "2",
  is_active: true,
  ai_enabled: false,
  calling_enabled: false,
  call_recording_enabled: false,
  call_forwarding_enabled: false,
  shopify_enabled: false,
  ai_monthly_token_cap: "",
  whatsapp_monthly_message_cap: "",
};

function priceLabel(pkg: PackageRow) {
  if (pkg.isFree || pkg.amountPaise === 0) return "Free";
  return `₹${pkg.amountPaise / 100}/${intervalPriceSuffix(pkg.interval)}`;
}

function canDelete(pkg: PackageRow) {
  return !pkg.isFree && pkg.slug !== "free" && (pkg.subscriberCount ?? 0) === 0;
}

function FeatureChip({ on, label }: { on: boolean; label: string }) {
  return (
    <Badge variant={on ? "default" : "outline"} className="font-normal">
      {label}
    </Badge>
  );
}

export default function SuperAdminPackagesPage() {
  const t = useTranslations("SuperAdmin.packages");
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PackageRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    const res = await fetch("/api/super-admin/billing/packages");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoadError(true);
      setPackages([]);
      setLoaded(true);
      return;
    }
    setLoadError(false);
    setPackages((data.packages ?? []) as PackageRow[]);
    setLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!loaded || typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    if (!hash.startsWith("pkg-")) return;
    const el = document.getElementById(hash);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [loaded, packages]);

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function startEdit(pkg: PackageRow) {
    setEditing(pkg.id);
    setForm({
      name: pkg.name,
      description: pkg.description ?? "",
      interval: pkg.interval,
      amount_rupees: String(pkg.amountPaise / 100),
      max_seats: String(pkg.maxSeats),
      is_active: pkg.isActive,
      ai_enabled: pkg.aiEnabled,
      calling_enabled: pkg.callingEnabled,
      call_recording_enabled: pkg.callRecordingEnabled,
      call_forwarding_enabled: pkg.callForwardingEnabled,
      shopify_enabled: pkg.shopifyEnabled,
      ai_monthly_token_cap: pkg.aiMonthlyTokenCap?.toString() ?? "",
      whatsapp_monthly_message_cap: pkg.whatsappMonthlyMessageCap?.toString() ?? "",
    });
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm);
  }

  async function toggleActive(pkg: PackageRow, next: boolean) {
    if (togglingId) return;
    setTogglingId(pkg.id);
    setPackages((prev) =>
      prev.map((row) => (row.id === pkg.id ? { ...row, isActive: next } : row)),
    );
    const res = await fetch(`/api/super-admin/billing/packages/${pkg.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      setPackages((prev) =>
        prev.map((row) => (row.id === pkg.id ? { ...row, isActive: pkg.isActive } : row)),
      );
      toast.error(t("updateFailed"));
      setTogglingId(null);
      return;
    }
    toast.success(next ? t("enabled") : t("disabled"));
    setTogglingId(null);
    await load();
    notifyPackagesChanged();
  }

  async function remove(pkg: PackageRow) {
    if (!canDelete(pkg)) {
      toast.error(
        pkg.isFree || pkg.slug === "free" ? t("deleteBlockedFree") : t("deleteBlockedInUse"),
      );
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/super-admin/billing/packages/${pkg.id}`, {
      method: "DELETE",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setDeleting(false);
    if (!res.ok) {
      toast.error(data.error ?? t("deleteFailed"));
      return;
    }
    toast.success(t("deleted"));
    setPendingDelete(null);
    if (editing === pkg.id) closeForm();
    await load();
    notifyPackagesChanged();
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name,
      description: form.description,
      interval: form.interval,
      amount_paise: Math.round(Number(form.amount_rupees || 0) * 100),
      max_seats: Number(form.max_seats),
      is_active: form.is_active,
      ai_enabled: form.ai_enabled,
      calling_enabled: form.calling_enabled,
      call_recording_enabled: form.call_recording_enabled,
      call_forwarding_enabled: form.call_forwarding_enabled,
      shopify_enabled: form.shopify_enabled,
      ai_monthly_token_cap: form.ai_monthly_token_cap || null,
      whatsapp_monthly_message_cap: form.whatsapp_monthly_message_cap || null,
    };
    const res = await fetch(
      editing
        ? `/api/super-admin/billing/packages/${editing}`
        : "/api/super-admin/billing/packages",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      warning?: string;
    };
    if (!res.ok) {
      setSaving(false);
      toast.error(data.error ?? t("saveFailed"));
      return;
    }
    toast.success(editing ? t("updated") : t("created"));
    if (data.warning) toast.message(data.warning);
    setSaving(false);
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm);
    await load();
    notifyPackagesChanged();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={startCreate} className="shrink-0 self-start">
          <Plus className="h-4 w-4" />
          {t("newPackage")}
        </Button>
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {t("all")}
          </h2>
          {loaded ? (
            <span className="text-sm text-muted-foreground">
              {t("count", { count: packages.length })}
            </span>
          ) : null}
        </div>

        {!loaded ? (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        ) : loadError ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-muted-foreground">{t("loadFailed")}</p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("retry")}
              </Button>
            </CardContent>
          </Card>
        ) : packages.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Package className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium">{t("empty")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
              </div>
              <Button onClick={startCreate}>
                <Plus className="h-4 w-4" />
                {t("newPackage")}
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {packages.map((pkg) => (
              <Card
                key={pkg.id}
                id={`pkg-${pkg.id}`}
                className={pkg.isActive ? undefined : "opacity-70"}
              >
                <CardHeader className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{pkg.name}</CardTitle>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {pkg.isFree ? <Badge variant="secondary">Free</Badge> : null}
                      <Badge variant={pkg.isActive ? "default" : "outline"}>
                        {pkg.isActive ? t("enabledBadge") : t("disabledBadge")}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-2xl font-semibold">{priceLabel(pkg)}</p>
                  <p className="text-xs text-muted-foreground">
                    {pkg.slug} · {t("seats", { count: pkg.maxSeats })}
                  </p>
                  {pkg.description ? (
                    <p className="text-sm text-muted-foreground">{pkg.description}</p>
                  ) : null}
                  {(pkg.subscriberCount ?? 0) > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t("inUse", { count: pkg.subscriberCount ?? 0 })}
                    </p>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    <FeatureChip on={pkg.callingEnabled} label="Live calling AI" />
                    <FeatureChip on={pkg.callRecordingEnabled} label="Call recording" />
                    <FeatureChip on={pkg.callForwardingEnabled} label="Call team forwarding" />
                    <FeatureChip on={pkg.aiEnabled} label="AI" />
                    <FeatureChip on={pkg.shopifyEnabled} label="Shopify" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {pkg.razorpayPlanId
                      ? t("razorpayReady")
                      : pkg.isFree
                        ? t("noCheckout")
                        : t("razorpayPending")}
                  </p>
                  <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{t("toggleLabel")}</p>
                      <p className="text-xs text-muted-foreground">
                        {pkg.isActive ? t("toggleOnHint") : t("toggleOffHint")}
                      </p>
                    </div>
                    <Switch
                      checked={pkg.isActive}
                      disabled={togglingId === pkg.id}
                      onCheckedChange={(v) => void toggleActive(pkg, !!v)}
                      aria-label={pkg.isActive ? t("disable") : t("enable")}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => startEdit(pkg)}>
                      {t("edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canDelete(pkg)}
                      title={
                        !canDelete(pkg)
                          ? pkg.isFree || pkg.slug === "free"
                            ? t("deleteBlockedFree")
                            : t("deleteBlockedInUse")
                          : t("delete")
                      }
                      onClick={() => setPendingDelete(pkg)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      {t("delete")}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <button
              type="button"
              onClick={startCreate}
              className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/40 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Plus className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium">{t("newPackage")}</span>
            </button>
          </div>
        )}
      </section>

      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (open) setFormOpen(true);
          else closeForm();
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("editTitle") : t("newTitle")}</DialogTitle>
            <DialogDescription>{t("newDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="pkg-name">{t("name")}</Label>
              <Input
                id="pkg-name"
                autoFocus
                placeholder="Pro"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void save();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pkg-desc">{t("description")}</Label>
              <Input
                id="pkg-desc"
                placeholder="Live calling AI + recording + Shopify"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="pkg-price">{t("price")}</Label>
                <Input
                  id="pkg-price"
                  type="number"
                  min="0"
                  placeholder="0"
                  value={form.amount_rupees}
                  onChange={(e) => setForm({ ...form, amount_rupees: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("interval")}</Label>
                <Select
                  value={form.interval}
                  onValueChange={(v) => {
                    if (v) setForm({ ...form, interval: v });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">{t("monthly")}</SelectItem>
                    <SelectItem value="quarter">{t("quarterly")}</SelectItem>
                    <SelectItem value="year">{t("yearly")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pkg-seats">{t("seatsLabel")}</Label>
                <Input
                  id="pkg-seats"
                  type="number"
                  min="1"
                  value={form.max_seats}
                  onChange={(e) => setForm({ ...form, max_seats: e.target.value })}
                />
              </div>
            </div>
            <ToggleRow
              label={t("toggleLabel")}
              hint={form.is_active ? t("toggleOnHint") : t("toggleOffHint")}
              checked={form.is_active}
              onChange={(v) => setForm({ ...form, is_active: v })}
            />
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow
                label="Live calling AI"
                checked={form.calling_enabled}
                onChange={(v) => setForm({ ...form, calling_enabled: v })}
              />
              <ToggleRow
                label="WhatsApp Call Recording"
                checked={form.call_recording_enabled}
                onChange={(v) => setForm({ ...form, call_recording_enabled: v })}
              />
              <ToggleRow
                label="Call team forwarding"
                checked={form.call_forwarding_enabled}
                onChange={(v) => setForm({ ...form, call_forwarding_enabled: v })}
              />
              <ToggleRow
                label="AI"
                checked={form.ai_enabled}
                onChange={(v) => setForm({ ...form, ai_enabled: v })}
              />
              <ToggleRow
                label="Shopify"
                checked={form.shopify_enabled}
                onChange={(v) => setForm({ ...form, shopify_enabled: v })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={saving} onClick={closeForm}>
              {t("cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : editing ? (
                <Pencil className="mr-2 h-4 w-4" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {editing ? t("update") : t("create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDesc", { name: pendingDelete?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => pendingDelete && void remove(pendingDelete)}
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
      <div>
        <span className="text-sm">{label}</span>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
