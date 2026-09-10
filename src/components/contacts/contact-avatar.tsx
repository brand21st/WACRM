"use client";

import { useCallback, useRef, useState } from "react";
import { Camera, ImagePlus, Link2, Loader2, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  contactAvatarColor,
  contactInitials,
  isAllowedAvatarFile,
  isHttpsUrl,
  persistContactAvatarUrl,
  uploadContactAvatar,
} from "@/lib/contacts/avatar";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const SIZE_CLASS = {
  xs: "size-8",
  sm: "size-9",
  md: "size-10",
  lg: "size-12",
  xl: "size-16",
  preview: "size-24",
} as const;

const TEXT_CLASS = {
  xs: "text-xs font-medium",
  sm: "text-xs font-medium",
  md: "text-sm font-medium",
  lg: "text-sm font-medium",
  xl: "text-lg font-semibold",
  preview: "text-2xl font-semibold",
} as const;

export type ContactAvatarSize = keyof typeof SIZE_CLASS;

export interface ContactAvatarProps {
  contactId?: string | null;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  size?: ContactAvatarSize;
  className?: string;
}

export function ContactAvatar({
  contactId,
  name,
  phone,
  avatarUrl,
  size = "md",
  className,
}: ContactAvatarProps) {
  const initials = contactInitials(name, phone);
  const color = contactAvatarColor(contactId || name || phone || initials);
  const displayName = name || phone || initials;

  return (
    <Avatar
      className={cn("after:hidden", SIZE_CLASS[size], className)}
      style={{ backgroundColor: color.bg }}
    >
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt={displayName} />
      ) : null}
      <AvatarFallback
        className={cn("border-0", TEXT_CLASS[size])}
        style={{ backgroundColor: color.bg, color: color.fg }}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

export interface ContactAvatarEditorProps extends ContactAvatarProps {
  contactId: string;
  onUpdated: (avatarUrl: string | null) => void;
  /** Kept so existing callers compile; the editor is a centered dialog. */
  popoverSide?: "top" | "bottom" | "left" | "right";
}

export function ContactAvatarEditor({
  contactId,
  name,
  phone,
  avatarUrl,
  size = "xl",
  className,
  onUpdated,
}: ContactAvatarEditorProps) {
  const t = useTranslations("Contacts.avatar");
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const displayName = name || phone || t("changePhoto");

  const applyUrl = useCallback(
    async (nextUrl: string | null) => {
      setSaving(true);
      try {
        const supabase = createClient();
        await persistContactAvatarUrl({
          supabase,
          contactId,
          avatarUrl: nextUrl,
        });
        onUpdated(nextUrl);
        toast.success(nextUrl ? t("photoUpdated") : t("photoRemoved"));
        setOpen(false);
        setUrlValue("");
      } catch (err) {
        toast.error(t("saveFailed"), {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setSaving(false);
      }
    },
    [contactId, onUpdated, t],
  );

  const applyFile = useCallback(
    async (file: File) => {
      if (!user) return;
      const check = isAllowedAvatarFile(file);
      if (check === "type") {
        toast.error(t("unsupportedImage"));
        return;
      }
      if (check === "size") {
        toast.error(t("imageTooLarge"));
        return;
      }
      setSaving(true);
      try {
        const supabase = createClient();
        const publicUrl = await uploadContactAvatar({
          supabase,
          userId: user.id,
          contactId,
          file,
        });
        await persistContactAvatarUrl({
          supabase,
          contactId,
          avatarUrl: publicUrl,
        });
        onUpdated(publicUrl);
        toast.success(t("photoUpdated"));
        setOpen(false);
        setUrlValue("");
      } catch (err) {
        toast.error(t("uploadFailed"), {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setSaving(false);
      }
    },
    [contactId, onUpdated, t, user],
  );

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void applyFile(file);
  };

  const onApplyPastedUrl = () => {
    const trimmed = urlValue.trim();
    if (!isHttpsUrl(trimmed)) {
      toast.error(t("invalidUrl"));
      return;
    }
    void applyUrl(trimmed);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const image = Array.from(e.clipboardData.items).find((item) =>
      item.type.startsWith("image/"),
    );
    if (image) {
      const file = image.getAsFile();
      if (file) {
        e.preventDefault();
        void applyFile(file);
        return;
      }
    }
    const text = e.clipboardData.getData("text").trim();
    if (text && isHttpsUrl(text) && e.target instanceof HTMLInputElement) {
      return;
    }
    if (text && isHttpsUrl(text)) {
      e.preventDefault();
      void applyUrl(text);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void applyFile(file);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setUrlValue("");
          setDragging(false);
        }
      }}
    >
      <DialogTrigger
        disabled={saving || !user}
        render={
          <button
            type="button"
            className={cn(
              "group relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
            aria-label={t("changePhoto")}
            onPaste={onPaste}
          />
        }
      >
        <ContactAvatar
          contactId={contactId}
          name={name}
          phone={phone}
          avatarUrl={avatarUrl}
          size={size}
        />
        <span
          className={cn(
            "absolute right-0 bottom-0 flex items-center justify-center rounded-full bg-foreground text-background shadow-sm ring-2 ring-card",
            size === "xl" || size === "preview" ? "size-6" : "size-5",
          )}
        >
          {saving ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Camera className={size === "xl" || size === "preview" ? "size-3" : "size-2.5"} />
          )}
        </span>
      </DialogTrigger>
      <DialogContent
        className="gap-5 sm:max-w-sm"
        onPaste={onPaste}
      >
        <DialogHeader className="items-center text-center sm:text-center">
          <div className="relative">
            <ContactAvatar
              contactId={contactId}
              name={name}
              phone={phone}
              avatarUrl={avatarUrl}
              size="preview"
            />
            {saving ? (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45">
                <Loader2 className="size-6 animate-spin text-white" />
              </span>
            ) : null}
          </div>
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription>{displayName}</DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={onPickFile}
        />

        <button
          type="button"
          disabled={saving || !user}
          onClick={() => fileInputRef.current?.click()}
          onDragEnter={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragging(false);
          }}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors outline-none",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            "disabled:pointer-events-none disabled:opacity-50",
            dragging
              ? "border-primary bg-primary/8 text-foreground"
              : "border-border bg-muted/30 text-foreground hover:border-primary/50 hover:bg-muted/60",
          )}
        >
          <span className="flex size-10 items-center justify-center rounded-full bg-background shadow-sm ring-1 ring-border">
            <ImagePlus className="size-5 text-foreground" />
          </span>
          <span className="text-sm font-medium">
            {dragging ? t("dropActive") : t("dropHint")}
          </span>
          <span className="text-xs text-muted-foreground">{t("photoHint")}</span>
        </button>

        <div className="space-y-1.5">
          <Label
            htmlFor={`contact-avatar-url-${contactId}`}
            className="text-xs text-muted-foreground"
          >
            <Link2 className="size-3.5" />
            {t("pasteUrl")}
          </Label>
          <div className="flex gap-2">
            <Input
              id={`contact-avatar-url-${contactId}`}
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder={t("pasteUrlPlaceholder")}
              disabled={saving}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onApplyPastedUrl();
                }
              }}
            />
            <Button
              type="button"
              disabled={saving || !urlValue.trim()}
              onClick={onApplyPastedUrl}
            >
              {t("applyUrl")}
            </Button>
          </div>
        </div>

        {avatarUrl ? (
          <Button
            type="button"
            variant="ghost"
            className="w-full text-destructive hover:text-destructive"
            disabled={saving}
            onClick={() => void applyUrl(null)}
          >
            <Trash2 className="size-4" />
            {t("removePhoto")}
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
