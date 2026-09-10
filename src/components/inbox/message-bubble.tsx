"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  MapPin,
  LayoutTemplate,
  CornerDownLeft,
  Sparkles,
  Phone,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import {
  MediaAudioBubble,
  MediaDocumentBubble,
  MediaImageBubble,
  MediaUnavailable,
  MediaVideoBubble,
} from "./message-media";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { parseCallPreview, formatCallDuration } from "@/lib/calls/preview";
import { CallBubbleRecording } from "./call-bubble-recording";
import { useTranslations } from "next-intl";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * Opens the thread's media viewer on this message. Only images and videos
   * call it; omitted when the parent renders no viewer, in which case media
   * stays inline and non-clickable.
   */
  onOpenMedia?: (messageId: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-chat-meta" />;
    case "sent":
      return <Check className="h-3 w-3 text-chat-meta" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-chat-meta" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-chat-ticks" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MessageContent({
  message,
  t,
  isAgent,
  onOpenMedia,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  /** Outbound bubbles sit on the WhatsApp mint/teal fill. */
  isAgent: boolean;
  onOpenMedia?: (messageId: string) => void;
}) {
  // Passed to the media bubbles as a no-arg callback; `undefined` when the
  // parent wired up no viewer, which is what makes them non-clickable.
  const openMedia = onOpenMedia ? () => onOpenMedia(message.id) : undefined;

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImageBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <MediaVideoBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <MediaAudioBubble message={message} t={t} />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return <MediaDocumentBubble message={message} t={t} />;

    case "template":
      // Templates are almost always outbound. The chip uses chat-ai so
      // it stays readable on mint / night teal (issue #483 also covered
      // empty bodies — fall back to the template name).
      return (
        <div>
          <span
            className={cn(
              "mb-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
              isAgent
                ? "bg-chat-ai/15 text-chat-ai"
                : "bg-primary/20 text-primary",
            )}
          >
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text ? (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          ) : (
            message.template_name && (
              <p className="mt-1 break-words text-sm italic opacity-80">
                {message.template_name}
              </p>
            )
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "order":
      if (message.interactive_payload) {
        return (
          <div className="flex flex-col gap-2">
            <InteractivePreview payload={message.interactive_payload} />
            <SendCartCheckoutButton message={message} t={t} />
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );

    case "call": {
      const parsed = parseCallPreview(message.content_text);
      const status = parsed?.status ?? "missed";
      const duration =
        parsed?.durationSeconds != null
          ? formatCallDuration(parsed.durationSeconds)
          : null;
      let label = t("callMissed");
      if (status === "completed") {
        label = duration
          ? t("callCompleted", { duration })
          : t("callCompletedUnknown");
      } else if (status === "rejected") {
        label = t("callRejected");
      } else if (status === "failed") {
        label = t("callFailed");
      } else if (status === "ringing" || status === "connecting") {
        label = t("callIncoming");
      } else if (status === "in_progress") {
        label = t("callInProgress");
      }
      return (
        <div>
          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span>{label}</span>
          </div>
          <CallBubbleRecording metaCallId={message.message_id} />
        </div>
      );
    }

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

function SendCartCheckoutButton({
  message,
  t,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
}) {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const inflight = useRef(false);

  if (message.interactive_payload?.kind !== "inbound_order") return null;

  return (
    <button
      type="button"
      disabled={busy || sent}
      onClick={() => {
        if (inflight.current || sent) return;
        inflight.current = true;
        void (async () => {
          setBusy(true);
          try {
            const res = await fetch("/api/commerce/retry-inbound-checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                conversation_id: message.conversation_id,
                message_id: message.id,
              }),
            });
            const data = (await res.json().catch(() => null)) as {
              error?: string;
            } | null;
            if (!res.ok) {
              inflight.current = false;
              toast.error(data?.error || t("checkoutSendFailed"));
              return;
            }
            setSent(true);
            toast.success(t("checkoutSent"));
          } catch {
            inflight.current = false;
            toast.error(t("checkoutSendFailed"));
          } finally {
            setBusy(false);
          }
        })();
      }}
      className="w-full rounded-md bg-background px-2 py-1.5 text-xs font-medium text-foreground ring-1 ring-border hover:bg-background/80 disabled:opacity-60"
    >
      {sent ? t("checkoutSent") : busy ? t("sendingCheckout") : t("sendCheckout")}
    </button>
  );
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  onOpenMedia,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-chat-bubble-out text-chat-bubble-fg"
            : "rounded-bl-md bg-chat-bubble-in text-chat-bubble-fg",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        <MessageContent
          message={message}
          t={t}
          isAgent={isAgent}
          onOpenMedia={onOpenMedia}
        />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound). Teal label matches WhatsApp's AI tag. */}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-chat-ai/15 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-chat-ai"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          {message.message_id?.startsWith("callturn:") && (
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide",
                isAgent
                  ? "bg-chat-ai/15 text-chat-ai"
                  : "bg-chat-bg/60 text-chat-meta",
              )}
            >
              {t("onCallBadge")}
            </span>
          )}
          <span className="text-[10px] text-chat-meta">
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
