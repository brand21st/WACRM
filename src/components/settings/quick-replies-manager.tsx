"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  FileText,
  ImageIcon,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  Video,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SettingsPanelHead } from "./settings-panel-head";
import {
  InteractiveBuilder,
  blankButtonsPayload,
  toComposerInteractivePayload,
  type ComposerInteractivePayload,
} from "@/components/interactive/interactive-builder";
import { interactivePayloadPreviewText } from "@/lib/whatsapp/interactive";
import {
  CHAT_MEDIA_BUCKET,
  MEDIA_CAPTION_MAX,
  MEDIA_MAX_BYTES_BY_KIND,
  MEDIA_PICKER_ACCEPT,
  deleteAccountMedia,
  uploadAccountMedia,
} from "@/lib/storage/upload-media";
import { isMediaQuickReplyKind } from "@/lib/quick-replies";
import type { QuickReply, QuickReplyKind } from "@/types";

const KIND_TABS: { id: QuickReplyKind; label: string }[] = [
  { id: "text", label: "Text" },
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "document", label: "Document" },
  { id: "interactive", label: "Interactive" },
];

interface DraftState {
  id?: string;
  title: string;
  kind: QuickReplyKind;
  content_text: string;
  interactive_payload: ComposerInteractivePayload;
  media_url: string;
  media_path: string;
  media_filename: string;
  /** Path already on the saved row — never GC on cancel. */
  originalMediaPath: string;
  /** Path uploaded in this dialog session — GC on cancel if unused. */
  sessionUploadPath: string;
}

function emptyDraft(): DraftState {
  return {
    title: "",
    kind: "text",
    content_text: "",
    interactive_payload: blankButtonsPayload(),
    media_url: "",
    media_path: "",
    media_filename: "",
    originalMediaPath: "",
    sessionUploadPath: "",
  };
}

function gcPath(path: string | undefined) {
  if (!path) return;
  void deleteAccountMedia(CHAT_MEDIA_BUCKET, path).catch(() => {});
}

export function QuickRepliesManager() {
  const [items, setItems] = useState<QuickReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/quick-replies", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setItems((data.quick_replies as QuickReply[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => setDraft(emptyDraft());
  const openEdit = (qr: QuickReply) =>
    setDraft({
      id: qr.id,
      title: qr.title,
      kind: qr.kind,
      content_text: qr.content_text ?? "",
      interactive_payload: toComposerInteractivePayload(qr.interactive_payload),
      media_url: qr.media_url ?? "",
      media_path: qr.media_path ?? "",
      media_filename: qr.media_filename ?? "",
      originalMediaPath: qr.media_path ?? "",
      sessionUploadPath: "",
    });

  const closeDraft = useCallback((current: DraftState | null) => {
    if (
      current?.sessionUploadPath &&
      current.sessionUploadPath !== current.originalMediaPath
    ) {
      gcPath(current.sessionUploadPath);
    }
    setDraft(null);
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      toast.error("Give the quick reply a name.");
      return;
    }

    let payload: Record<string, unknown>;
    if (draft.kind === "interactive") {
      payload = {
        title: draft.title,
        kind: "interactive",
        interactive_payload: draft.interactive_payload,
      };
    } else if (isMediaQuickReplyKind(draft.kind)) {
      if (!draft.media_url || !draft.media_path) {
        toast.error("Upload a file for this quick reply.");
        return;
      }
      payload = {
        title: draft.title,
        kind: draft.kind,
        media_url: draft.media_url,
        media_path: draft.media_path,
        media_filename: draft.media_filename,
        content_text: draft.content_text,
      };
    } else {
      payload = {
        title: draft.title,
        kind: "text",
        content_text: draft.content_text,
      };
    }

    setSaving(true);
    try {
      const res = await fetch(
        draft.id ? `/api/quick-replies/${draft.id}` : "/api/quick-replies",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't save the quick reply.");
        return;
      }
      toast.success(draft.id ? "Quick reply updated." : "Quick reply created.");
      setDraft(null);
      await load();
    } catch {
      toast.error("Couldn't save the quick reply.");
    } finally {
      setSaving(false);
    }
  }, [draft, load]);

  const remove = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this quick reply?")) return;
      const res = await fetch(`/api/quick-replies/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete the quick reply.");
        return;
      }
      await load();
    },
    [load],
  );

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!draft || !isMediaQuickReplyKind(draft.kind) || !file) return;
      const max = MEDIA_MAX_BYTES_BY_KIND[draft.kind];
      if (file.size > max) {
        toast.error(
          `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — ${draft.kind} limit is ${Math.round(max / 1024 / 1024)} MB.`,
        );
        return;
      }
      setUploading(true);
      try {
        const { publicUrl, path } = await uploadAccountMedia(
          CHAT_MEDIA_BUCKET,
          file,
        );
        if (
          draft.sessionUploadPath &&
          draft.sessionUploadPath !== draft.originalMediaPath
        ) {
          gcPath(draft.sessionUploadPath);
        }
        setDraft({
          ...draft,
          media_url: publicUrl,
          media_path: path,
          media_filename: file.name,
          sessionUploadPath: path,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
      }
    },
    [draft],
  );

  return (
    <div>
      <SettingsPanelHead
        title="Quick replies"
        description="Reusable snippets — text, image, video, document, or a saved interactive message — that agents can insert from the inbox composer."
        action={
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            New quick reply
          </Button>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No quick replies yet. Create one to reuse it across conversations.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((qr) => (
            <li
              key={qr.id}
              className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
            >
              <KindIcon kind={qr.kind} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {qr.title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {previewFor(qr)}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => openEdit(qr)}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(qr.id)}
                  className="text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={!!draft}
        onOpenChange={(o) => {
          if (!o) closeDraft(draft);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Edit quick reply" : "New quick reply"}
            </DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="max-h-[70vh] space-y-3 overflow-y-auto">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Name
                </label>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="e.g. Business hours"
                  className="bg-muted text-foreground"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {KIND_TABS.map((tab) => (
                  <KindTab
                    key={tab.id}
                    active={draft.kind === tab.id}
                    label={tab.label}
                    onClick={() => setDraft({ ...draft, kind: tab.id })}
                  />
                ))}
              </div>
              {draft.kind === "text" ? (
                <Textarea
                  value={draft.content_text}
                  onChange={(e) =>
                    setDraft({ ...draft, content_text: e.target.value })
                  }
                  placeholder="The message text to insert"
                  className="min-h-28 bg-muted text-foreground"
                />
              ) : draft.kind === "interactive" ? (
                <InteractiveBuilder
                  value={draft.interactive_payload}
                  onChange={(p) =>
                    setDraft({ ...draft, interactive_payload: p })
                  }
                />
              ) : (
                <MediaDraftFields
                  kind={draft.kind}
                  mediaUrl={draft.media_url}
                  filename={draft.media_filename}
                  caption={draft.content_text}
                  uploading={uploading}
                  fileInputRef={fileInputRef}
                  onCaptionChange={(content_text) =>
                    setDraft({ ...draft, content_text })
                  }
                  onPickFile={() => fileInputRef.current?.click()}
                  onFile={(file) => void handleFile(file)}
                />
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => closeDraft(draft)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || uploading}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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

function KindIcon({ kind }: { kind: QuickReplyKind }) {
  const className = "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground";
  if (kind === "interactive") {
    return <Zap className="mt-0.5 h-4 w-4 shrink-0 text-primary" />;
  }
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "video") return <Video className={className} />;
  if (kind === "document") return <FileText className={className} />;
  return <MessageSquare className={className} />;
}

function KindTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
          : "rounded-md border border-border bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}

function MediaDraftFields({
  kind,
  mediaUrl,
  filename,
  caption,
  uploading,
  fileInputRef,
  onCaptionChange,
  onPickFile,
  onFile,
}: {
  kind: "image" | "video" | "document";
  mediaUrl: string;
  filename: string;
  caption: string;
  uploading: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  onCaptionChange: (caption: string) => void;
  onPickFile: () => void;
  onFile: (file: File | undefined) => void;
}) {
  return (
    <div className="space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept={MEDIA_PICKER_ACCEPT[kind]}
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {mediaUrl ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          {kind === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl}
              alt={filename}
              className="max-h-40 rounded-md object-cover"
            />
          )}
          {kind === "video" && (
            <video src={mediaUrl} controls className="max-h-40 rounded-md" />
          )}
          {kind === "document" && (
            <div className="flex items-center gap-2 text-sm text-foreground">
              <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="truncate">{filename || "Document"}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
          No file yet.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={onPickFile}
        disabled={uploading}
      >
        {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        {mediaUrl ? "Replace file" : "Upload file"}
      </Button>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Caption (optional)
        </label>
        <Input
          value={caption}
          maxLength={MEDIA_CAPTION_MAX}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder="Shown with the file on WhatsApp"
          className="bg-muted text-foreground"
        />
      </div>
    </div>
  );
}
