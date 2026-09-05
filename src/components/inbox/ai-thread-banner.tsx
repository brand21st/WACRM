"use client";

import { cn } from "@/lib/utils";

export { invalidateAiAccountStatusCache } from "./use-inbox-ai-account-status";

interface AiThreadBannerProps {
  /** `conversations.ai_handoff_summary` — note the bot left on handoff. */
  handoffSummary?: string | null;
}

/**
 * Slim handoff note above the composer. Per-thread AI on/off lives in
 * the chat header (`AiThreadToggle`); this only surfaces the summary
 * the bot left when it handed the thread to a human.
 */
export function AiThreadBanner({ handoffSummary }: AiThreadBannerProps) {
  if (!handoffSummary) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-xs sm:px-4",
      )}
    >
      <p className="min-w-0 flex-1 truncate text-muted-foreground" title={handoffSummary}>
        {handoffSummary}
      </p>
    </div>
  );
}
