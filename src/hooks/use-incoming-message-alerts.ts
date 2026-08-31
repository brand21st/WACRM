"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import type { Message } from "@/types";
import {
  INCOMING_SOUND_COOLDOWN_MS,
  shouldNotifyIncoming,
  viewingConversationIdFromLocation,
} from "@/lib/notifications/incoming-notify";
import {
  contactDisplayName,
  incomingPreviewKind,
  incomingPreviewText,
  type IncomingPreviewKind,
} from "@/lib/notifications/incoming-preview";
import { readIncomingAlertPrefs } from "@/lib/notifications/incoming-prefs";
import {
  playIncomingMessageSound,
  unlockIncomingSound,
} from "@/lib/notifications/incoming-sound";

type ContactJoin = { name?: string | null; phone?: string | null };

const DESKTOP_TAG = "wacrm-incoming";

/**
 * App-wide inbound WhatsApp alerts. Mount once in the signed-in
 * dashboard shell (its own realtime channel, distinct from the inbox
 * page) so a new customer message chimes / toasts even when the agent
 * is on Contacts, Settings, etc.
 */
export function useIncomingMessageAlerts() {
  const router = useRouter();
  const t = useTranslations("IncomingAlerts");
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastSoundAtRef = useRef(0);
  const nameCacheRef = useRef<Map<string, string>>(new Map());
  const tRef = useRef(t);
  const routerRef = useRef(router);
  useEffect(() => {
    tRef.current = t;
    routerRef.current = router;
  });

  useEffect(() => {
    const unlock = () => unlockIncomingSound();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  // Ask for Notification permission on the first gesture if the agent
  // left desktop alerts on (the default). Browsers ignore this without
  // a gesture; the settings toggle also requests on click.
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;
    if (!readIncomingAlertPrefs().desktop) return;
    const ask = () => {
      if (Notification.permission === "default") {
        void Notification.requestPermission();
      }
    };
    window.addEventListener("pointerdown", ask, { once: true });
    return () => window.removeEventListener("pointerdown", ask);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const tNow = () => tRef.current;
    const go = (path: string) => routerRef.current.push(path);

    function previewLabels(): Record<
      Exclude<IncomingPreviewKind, "text">,
      string
    > {
      const tr = tNow();
      return {
        image: tr("previewImage"),
        video: tr("previewVideo"),
        audio: tr("previewAudio"),
        document: tr("previewDocument"),
        location: tr("previewLocation"),
        interactive: tr("previewInteractive"),
        default: tr("previewDefault"),
      };
    }

    async function resolveName(conversationId: string): Promise<string> {
      const cached = nameCacheRef.current.get(conversationId);
      if (cached) return cached;
      const fallback = tNow()("toastFallbackName");
      const { data } = await supabase
        .from("conversations")
        .select("contact:contacts(name, phone)")
        .eq("id", conversationId)
        .maybeSingle();
      const contact = unwrapContact(
        (data as { contact?: ContactJoin | ContactJoin[] | null } | null)
          ?.contact,
      );
      const name =
        contactDisplayName(contact?.name, contact?.phone) ?? fallback;
      nameCacheRef.current.set(conversationId, name);
      return name;
    }

    async function handleInsert(msg: Message) {
      const alreadySeen = seenIdsRef.current.has(msg.id);
      if (!alreadySeen) {
        seenIdsRef.current.add(msg.id);
        if (seenIdsRef.current.size > 400) seenIdsRef.current.clear();
      }

      const decision = shouldNotifyIncoming({
        senderType: msg.sender_type,
        conversationId: msg.conversation_id,
        messageId: msg.id,
        viewingConversationId: viewingConversationIdFromLocation(
          window.location.pathname,
          window.location.search,
        ),
        documentHidden: document.hidden,
        alreadySeen,
      });
      if (!decision.sound && !decision.toast && !decision.desktop) return;

      const prefs = readIncomingAlertPrefs();
      const kind = incomingPreviewKind(msg.content_type, msg.content_text);
      const preview = incomingPreviewText(
        kind,
        msg.content_text,
        previewLabels(),
      );
      const name = await resolveName(msg.conversation_id);
      const title = tNow()("toastTitle", { name });

      if (decision.sound && prefs.sound) {
        const now = Date.now();
        if (now - lastSoundAtRef.current >= INCOMING_SOUND_COOLDOWN_MS) {
          lastSoundAtRef.current = now;
          playIncomingMessageSound();
        }
      }

      if (decision.toast) {
        toast(title, {
          description: preview,
          duration: 5_000,
          action: {
            label: tNow()("open"),
            onClick: () => go(`/inbox?c=${msg.conversation_id}`),
          },
        });
      }

      if (
        decision.desktop &&
        prefs.desktop &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        try {
          const n = new Notification(title, {
            body: preview,
            tag: DESKTOP_TAG,
            // `renotify` is in the Notifications spec but missing from
            // TypeScript's DOM `NotificationOptions` in this toolchain.
            ...({ renotify: true } as NotificationOptions),
          });
          n.onclick = () => {
            window.focus();
            go(`/inbox?c=${msg.conversation_id}`);
            n.close();
          };
        } catch {
          // Some browsers throw if the page isn't focused enough.
        }
      }
    }

    const channel = supabase
      .channel("incoming-message-alerts")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          void handleInsert(payload.new as Message);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);
}

function unwrapContact(
  contact: ContactJoin | ContactJoin[] | null | undefined,
): ContactJoin | null {
  if (!contact) return null;
  return Array.isArray(contact) ? (contact[0] ?? null) : contact;
}
