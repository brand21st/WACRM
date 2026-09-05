"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { AI_FULL_AGENT_CHANGED } from "./ai-full-agent-events";

/**
 * Account AI status is the same for every conversation, so cache it per
 * account and reuse it across thread switches / list items instead of
 * hitting /api/ai/config on every open.
 *
 * Keyed by accountId (a multi-account user switching workspaces must not
 * see the previous account's status), and only *successful* fetches are
 * cached — a transient failure returns a default without poisoning the
 * cache, so it retries on the next mount rather than hiding the toggle
 * for the whole session.
 */
export interface InboxAiAccountStatus {
  autoReplyOn: boolean;
  fullAgentOn: boolean;
}

const statusCache = new Map<string, InboxAiAccountStatus>();

/** Drop cached account AI status after a settings change from the inbox. */
export function invalidateAiAccountStatusCache(accountId: string) {
  statusCache.delete(accountId);
}

async function fetchAiAccountStatus(
  accountId: string,
): Promise<InboxAiAccountStatus> {
  const cached = statusCache.get(accountId);
  if (cached) return cached;
  try {
    const res = await fetch("/api/ai/config", { cache: "no-store" });
    if (!res.ok) return { autoReplyOn: false, fullAgentOn: false };
    const j = await res.json();
    const status = {
      autoReplyOn: !!(j?.configured && j?.is_active && j?.auto_reply_enabled),
      fullAgentOn: !!(j?.configured && j?.full_agent_enabled),
    };
    statusCache.set(accountId, status);
    return status;
  } catch {
    return { autoReplyOn: false, fullAgentOn: false };
  }
}

export function useInboxAiAccountStatus(): InboxAiAccountStatus {
  const { accountId } = useAuth();
  const [status, setStatus] = useState<InboxAiAccountStatus>({
    autoReplyOn: false,
    fullAgentOn: false,
  });

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    const load = () =>
      fetchAiAccountStatus(accountId).then((s) => {
        if (!alive) return;
        setStatus(s);
      });
    void load();
    const onFullAgentChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ accountId?: string }>).detail;
      if (detail?.accountId !== accountId) return;
      invalidateAiAccountStatusCache(accountId);
      void load();
    };
    window.addEventListener(AI_FULL_AGENT_CHANGED, onFullAgentChanged);
    return () => {
      alive = false;
      window.removeEventListener(AI_FULL_AGENT_CHANGED, onFullAgentChanged);
    };
  }, [accountId]);

  return status;
}
