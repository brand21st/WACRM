"use client";

import { useEffect, useState } from "react";
import { FileText, ImageIcon, Loader2, MessageSquare, Video, Zap } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QuickReply, QuickReplyKind } from "@/types";
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive";
import { isMediaQuickReplyKind } from "@/lib/quick-replies";

interface QuickReplyPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (qr: QuickReply) => void;
}

/**
 * Lists the account's saved quick replies for insertion into the
 * composer. Text snippets fill the textarea; interactive snippets open
 * the builder pre-filled; media snippets stage a composer draft
 * (handled by the caller's `onPick`).
 */
export function QuickReplyPicker({
  open,
  onOpenChange,
  onPick,
}: QuickReplyPickerProps) {
  const t = useTranslations("Inbox.composer");
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/quick-replies", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setItems((data.quick_replies as QuickReply[]) ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("quickReplies")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t("quickRepliesEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((qr) => (
                <li key={qr.id}>
                  <button
                    type="button"
                    onClick={() => onPick(qr)}
                    className="flex w-full items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-left hover:border-primary/50 hover:bg-muted"
                  >
                    {qr.kind === "image" && qr.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qr.media_url}
                        alt=""
                        className="mt-0.5 h-8 w-8 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <KindGlyph kind={qr.kind} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {qr.title}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {previewFor(qr)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function previewFor(qr: QuickReply): string {
  if (qr.kind === "interactive" && qr.interactive_payload) {
    return interactivePayloadPreviewText(qr.interactive_payload);
  }
  if (isMediaQuickReplyKind(qr.kind)) {
    return qr.content_text?.trim() || qr.media_filename || qr.kind;
  }
  return qr.content_text ?? "";
}

function KindGlyph({ kind }: { kind: QuickReplyKind }) {
  const className = "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground";
  if (kind === "interactive") {
    return <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />;
  }
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "video") return <Video className={className} />;
  if (kind === "document") return <FileText className={className} />;
  return <MessageSquare className={className} />;
}
