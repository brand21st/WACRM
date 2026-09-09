"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MessageTemplate } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  LayoutTemplate,
  Loader2,
  Search,
  Store,
} from "lucide-react";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import { isShopifyTemplateName } from "@/lib/shopify/notification-templates";
import { useTranslations } from "next-intl";

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
}

type SourceFilter = "all" | "shopify" | "other";

const WHATSAPP_CATEGORY_COLORS: Record<string, string> = {
  Marketing: "bg-purple-600/20 text-purple-400 border-purple-600/30",
  Utility: "bg-blue-600/20 text-blue-400 border-blue-600/30",
  Authentication: "bg-amber-600/20 text-amber-400 border-amber-600/30",
};

function humanizeTemplateName(name: string): string {
  const stripped = isShopifyTemplateName(name)
    ? name.slice("shopify_".length)
    : name;
  return stripped
    .split("_")
    .filter(Boolean)
    .map((part, i) =>
      i === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === "text" && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === "URL" && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots };
}

function matchesSearch(template: MessageTemplate, query: string): boolean {
  if (!query) return true;
  const haystack = `${template.name} ${template.body_text}`.toLowerCase();
  return haystack.includes(query);
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
}: TemplatePickerProps) {
  const t = useTranslations("Inbox.templatePicker");

  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>("");
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      // Scope by RLS (message_templates_select → is_account_member), NOT by
      // user_id. Templates are account-owned, so filtering on the caller's
      // user_id hid templates that a teammate created — leaving them unable
      // to send approved templates in a shared account.
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("status", "APPROVED")
        .order("created_at", { ascending: false });

      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function resetBrowse() {
    setSearch("");
    setSourceFilter("all");
  }

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText("");
    setButtonParams({});
    resetBrowse();
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(slots.bodyVars.length).fill(""));
    setHeaderText("");
    setButtonParams({});
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()]),
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected],
  );
  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (params[i] ?? "").trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? "").trim().length > 0,
    );

  const query = search.trim().toLowerCase();

  const { shopifyTemplates, otherTemplates, hasShopify, hasOther } =
    useMemo(() => {
      const shopify: MessageTemplate[] = [];
      const other: MessageTemplate[] = [];
      for (const tpl of templates) {
        if (isShopifyTemplateName(tpl.name)) shopify.push(tpl);
        else other.push(tpl);
      }
      return {
        shopifyTemplates: shopify.filter((tpl) => matchesSearch(tpl, query)),
        otherTemplates: other.filter((tpl) => matchesSearch(tpl, query)),
        hasShopify: shopify.length > 0,
        hasOther: other.length > 0,
      };
    }, [templates, query]);

  const visibleShopify =
    sourceFilter === "other" ? [] : shopifyTemplates;
  const visibleOther = sourceFilter === "shopify" ? [] : otherTemplates;
  const hasVisibleResults =
    visibleShopify.length > 0 || visibleOther.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-popover sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <LayoutTemplate className="h-4 w-4 text-primary" />
            {selected ? selected.name : t("sendTemplate")}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected ? t("fillPlaceholders") : t("pickTemplate")}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : templates.length === 0 ? (
              <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                <p className="text-sm text-popover-foreground">
                  {t("noApprovedTemplates")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("noApprovedTemplatesHint")}
                </p>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    className="h-9 border-border bg-muted pl-9 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50"
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <FilterChip
                    active={sourceFilter === "all"}
                    count={shopifyTemplates.length + otherTemplates.length}
                    onClick={() => setSourceFilter("all")}
                    label={t("categoryAll")}
                  />
                  {hasShopify && (
                    <FilterChip
                      active={sourceFilter === "shopify"}
                      count={shopifyTemplates.length}
                      onClick={() => setSourceFilter("shopify")}
                      label={t("categoryShopify")}
                    />
                  )}
                  {hasOther && (
                    <FilterChip
                      active={sourceFilter === "other"}
                      count={otherTemplates.length}
                      onClick={() => setSourceFilter("other")}
                      label={t("categoryOther")}
                    />
                  )}
                </div>

                {hasVisibleResults ? (
                  <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-0.5">
                    {visibleShopify.length > 0 && (
                      <TemplateSection
                        icon={Store}
                        title={t("categoryShopify")}
                        count={visibleShopify.length}
                      >
                        {visibleShopify.map((tpl) => (
                          <TemplateCard
                            key={tpl.id}
                            template={tpl}
                            onPick={pickTemplate}
                          />
                        ))}
                      </TemplateSection>
                    )}
                    {visibleOther.length > 0 && (
                      <TemplateSection
                        icon={FileText}
                        title={t("categoryOther")}
                        count={visibleOther.length}
                      >
                        {visibleOther.map((tpl) => (
                          <TemplateCard
                            key={tpl.id}
                            template={tpl}
                            onPick={pickTemplate}
                          />
                        ))}
                      </TemplateSection>
                    )}
                  </div>
                ) : (
                  <div className="rounded-md border border-border bg-background/50 p-6 text-center">
                    <p className="text-sm text-popover-foreground">
                      {t("noMatch")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("noMatchHint")}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={resetBrowse}
                      className="mt-3 border-border text-popover-foreground hover:bg-muted"
                    >
                      {t("clearFilters")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-background/50 p-3">
              <p className="mb-1 text-xs text-muted-foreground">{t("preview")}</p>
              <p className="whitespace-pre-wrap text-sm text-popover-foreground">
                {renderBodyPreview(selected.body_text, params)}
              </p>
              {selected.footer_text && (
                <p className="mt-2 text-xs italic text-muted-foreground">
                  {selected.footer_text}
                </p>
              )}
            </div>
            {slots && slots.headerVarCount > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`Header {{1}}`}
                </Label>
                <Input
                  value={headerText}
                  onChange={(e) => setHeaderText(e.target.value)}
                  placeholder={t("headerValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            )}
            {slots?.bodyVars.map((v, i) => (
              <div key={v} className="space-y-1">
                <Label className="text-xs text-popover-foreground">{`Body {{${v}}}`}</Label>
                <Input
                  value={params[i] ?? ""}
                  onChange={(e) => {
                    const next = [...params];
                    next[i] = e.target.value;
                    setParams(next);
                  }}
                  placeholder={t("bodyValuePlaceholder", { val: `{{${v}}}` })}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
              </div>
            ))}
            {slots?.urlButtonSlots.map((slot) => (
              <div key={slot.index} className="space-y-1">
                <Label className="text-xs text-popover-foreground">
                  {`URL button "${slot.text}" — value for `}
                  {`{{1}}`}
                </Label>
                <Input
                  value={buttonParams[slot.index] ?? ""}
                  onChange={(e) =>
                    setButtonParams((prev) => ({
                      ...prev,
                      [slot.index]: e.target.value,
                    }))
                  }
                  placeholder={t("urlSuffixValuePlaceholder")}
                  className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                />
                <p className="text-[10px] break-all text-muted-foreground">
                  {t("finalUrl", {
                    url: slot.url.replace(
                      /\{\{1\}\}/g,
                      buttonParams[slot.index] || "{{1}}",
                    ),
                  })}
                </p>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setSelected(null);
                  setParams([]);
                  setHeaderText("");
                  setButtonParams({});
                }}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("back")}
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t("send")}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t("cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterChip({
  active,
  count,
  onClick,
  label,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border bg-background/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
      )}
    >
      {label}
      <span className="tabular-nums text-[10px] opacity-70">{count}</span>
    </button>
  );
}

function TemplateSection({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Store;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-muted/20">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-popover/95 px-3 py-2 backdrop-blur-sm">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-xs font-semibold tracking-wide text-popover-foreground">
          {title}
        </h3>
        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="space-y-2 p-2">{children}</div>
    </section>
  );
}

function TemplateCard({
  template,
  onPick,
}: {
  template: MessageTemplate;
  onPick: (template: MessageTemplate) => void;
}) {
  const categoryColor =
    WHATSAPP_CATEGORY_COLORS[template.category] ??
    WHATSAPP_CATEGORY_COLORS.Utility;

  return (
    <button
      type="button"
      onClick={() => onPick(template)}
      className="w-full rounded-md border border-border bg-background/70 p-3 text-left transition-colors hover:border-primary/40 hover:bg-popover"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium text-popover-foreground">
              {humanizeTemplateName(template.name)}
            </p>
            <Badge
              className={cn("border text-[10px]", categoryColor)}
            >
              {template.category}
            </Badge>
            {template.language && (
              <span className="text-[10px] uppercase text-muted-foreground">
                {template.language}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
            {template.name}
          </p>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {template.body_text}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
}
