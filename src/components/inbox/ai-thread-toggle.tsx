"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { useInboxAiAccountStatus } from "./use-inbox-ai-account-status";

interface AiThreadToggleProps {
  conversationId: string;
  /** `conversations.ai_autoreply_disabled` — bot paused on this thread. */
  disabled: boolean;
  /** Current assignee; assignment also blocks the bot. */
  assignedAgentId?: string | null;
  /** The acting agent — turning AI off assigns the thread to them. */
  currentUserId?: string | null;
  onChange?: (patch: {
    ai_autoreply_disabled: boolean;
    assigned_agent_id?: string | null;
  }) => void;
}

/**
 * Compact header switch: AI on/off for this conversation. Visible only
 * when Fully automated AI agent is on. Off = manual chat (pause + assign).
 */
export function AiThreadToggle({
  conversationId,
  disabled,
  assignedAgentId,
  currentUserId,
  onChange,
}: AiThreadToggleProps) {
  const t = useTranslations("Inbox.messageThread");
  const tBanner = useTranslations("Inbox.aiBanner");
  const { fullAgentOn } = useInboxAiAccountStatus();
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(disabled);

  useEffect(() => {
    setPaused(disabled);
  }, [conversationId, disabled]);

  const aiOn = !paused && !assignedAgentId;

  const toggle = useCallback(
    async (nextOn: boolean) => {
      const nextPaused = !nextOn;
      const prevPaused = paused;
      const prevAssignee = assignedAgentId ?? null;
      const nextAssignee = nextPaused ? (currentUserId ?? null) : null;
      setBusy(true);
      setPaused(nextPaused);
      onChange?.({
        ai_autoreply_disabled: nextPaused,
        assigned_agent_id: nextAssignee,
      });
      try {
        const res = await fetch(`/api/ai/autoreply/${conversationId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paused: nextPaused,
            assign_to_me: nextPaused,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          setPaused(prevPaused);
          onChange?.({
            ai_autoreply_disabled: prevPaused,
            assigned_agent_id: prevAssignee,
          });
          toast.error(j?.error ?? tBanner("updateError"));
          return;
        }
        toast.success(nextOn ? t("aiOn") : t("aiOff"));
      } catch {
        setPaused(prevPaused);
        onChange?.({
          ai_autoreply_disabled: prevPaused,
          assigned_agent_id: prevAssignee,
        });
        toast.error(tBanner("networkError"));
      } finally {
        setBusy(false);
      }
    },
    [
      assignedAgentId,
      conversationId,
      currentUserId,
      onChange,
      paused,
      t,
      tBanner,
    ],
  );

  if (!fullAgentOn) return null;

  return (
    <div className="inline-flex shrink-0 items-center gap-1.5">
      <span className="text-xs font-medium text-foreground">{t("aiToggle")}</span>
      <Switch
        checked={aiOn}
        onCheckedChange={toggle}
        disabled={busy}
        aria-label={t("aiToggle")}
      />
    </div>
  );
}
