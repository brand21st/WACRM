"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot, Loader2, MessageSquareText, Mic, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AiProvider } from "@/lib/ai/types";
import { AI_PROVIDER_DEFAULT_MODEL } from "@/lib/ai/defaults";
import { invalidateAiAccountStatusCache } from "./ai-thread-banner";
import { dispatchAiFullAgentChanged } from "./ai-full-agent-events";

interface AiAgentPanelProps {
  className?: string;
}

/**
 * Inbox control for the fully automated AI agent. Toggles account-level
 * full-agent mode (text + voice + images) without leaving the inbox.
 */
export function InboxAiAgentPanel({ className }: AiAgentPanelProps) {
  const t = useTranslations("Inbox.aiAgent");
  const { accountId, accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [fullAgentEnabled, setFullAgentEnabled] = useState(false);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);

  const fetchStatus = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/ai/config", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setConfigured(false);
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setIsActive(Boolean(data.is_active));
        setAutoReplyEnabled(Boolean(data.auto_reply_enabled));
        setFullAgentEnabled(Boolean(data.full_agent_enabled));
        if (data.provider === "openai" || data.provider === "anthropic") {
          setProvider(data.provider);
        }
        if (typeof data.model === "string" && data.model.trim()) {
          setModel(data.model.trim());
        }
      } else {
        setConfigured(false);
      }
    } catch {
      setConfigured(false);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleToggle = async (next: boolean) => {
    if (!canEdit) return;
    setSaving(true);
    const prev = fullAgentEnabled;
    setFullAgentEnabled(next);
    try {
      const res = await fetch("/api/ai/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          model,
          full_agent_enabled: next,
          ...(next
            ? { auto_reply_enabled: true, is_active: true }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFullAgentEnabled(prev);
        toast.error(data.error ?? t("saveFailed"));
        return;
      }
      if (next) {
        setAutoReplyEnabled(true);
        setIsActive(true);
      }
      if (accountId) invalidateAiAccountStatusCache(accountId);
      dispatchAiFullAgentChanged(accountId!, next);
      toast.success(next ? t("enabled") : t("disabled"));
    } catch {
      setFullAgentEnabled(prev);
      toast.error(t("networkError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !configured) return null;

  const live = isActive && autoReplyEnabled && fullAgentEnabled;

  return (
    <div
      className={cn(
        "min-w-0 max-w-full border-b border-border bg-muted/30 px-3 py-2 sm:px-4 lg:py-2.5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-3 lg:items-start">
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-center gap-1.5">
            <Bot
              className={cn(
                "h-4 w-4 flex-shrink-0",
                live ? "text-primary" : "text-muted-foreground",
              )}
            />
            <p className="truncate text-sm font-medium text-foreground">
              {t("title")}
            </p>
          </div>
          <p className="mt-0.5 hidden text-xs text-muted-foreground lg:block">
            {t("desc")}
          </p>
          <div className="mt-2 hidden flex-wrap gap-1.5 lg:flex">
            <ModalityBadge icon={MessageSquareText} label={t("text")} />
            <ModalityBadge icon={Mic} label={t("voice")} />
            <ModalityBadge icon={ImageIcon} label={t("images")} />
          </div>
        </div>
        <Switch
          checked={fullAgentEnabled}
          onCheckedChange={handleToggle}
          disabled={!canEdit || saving}
          aria-label={t("title")}
          className="shrink-0"
        />
      </div>
      {!canEdit && (
        <p className="mt-2 hidden text-[11px] text-muted-foreground lg:block">
          {t("viewOnly")}
        </p>
      )}
      {!isActive || !autoReplyEnabled ? (
        <p className="mt-1 truncate text-[11px] text-amber-600 lg:mt-2 dark:text-amber-400">
          {t("needsSetup")}{" "}
          <Link href="/agents" className="underline underline-offset-2">
            {t("setupLink")}
          </Link>
        </p>
      ) : null}
      {saving && (
        <div className="mt-1 hidden items-center gap-1 text-[11px] text-muted-foreground lg:flex">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("saving")}
        </div>
      )}
    </div>
  );
}

function ModalityBadge({
  icon: Icon,
  label,
}: {
  icon: typeof Bot;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
