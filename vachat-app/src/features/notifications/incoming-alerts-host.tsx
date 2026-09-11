import * as Notifications from 'expo-notifications';
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';

import { IncomingMessageBanner } from '@/features/notifications/incoming-banner';
import { useIncomingAlertPrefs } from '@/features/notifications/use-incoming-alert-prefs';
import { useAuth } from '@/features/auth/auth-context';
import { useConversations } from '@/features/conversations/use-conversations';
import { logger } from '@/lib/logger';
import { getSupabase } from '@/lib/supabase';
import {
  INCOMING_SOUND_COOLDOWN_MS,
  shouldNotifyIncoming,
  viewingConversationIdFromPath,
} from '@/lib/notifications/incoming-notify';
import {
  INCOMING_PREVIEW_LABELS,
  contactDisplayName,
  incomingPreviewKind,
  incomingPreviewText,
} from '@/lib/notifications/incoming-preview';
import { playIncomingMessageSound } from '@/lib/notifications/incoming-sound';
import {
  getExpoPushToken,
  isExpoGoAndroid,
  openConversationFromNotificationResponse,
  presentLocalIncomingNotification,
  registerExpoPushToken,
  unregisterExpoPushToken,
  type IncomingBannerPayload,
} from '@/lib/notifications/push';
import type { Message } from '@/types/messages';
import type { MobileConversation } from '@/types/conversations';

function openConversation(conversationId: string) {
  router.push({ pathname: '/chat/[id]', params: { id: conversationId } });
}

function IncomingAlertsRuntime() {
  const pathname = usePathname();
  const { prefs } = useIncomingAlertPrefs();
  const conversations = useConversations();
  const [banner, setBanner] = useState<IncomingBannerPayload | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const lastSoundAtRef = useRef(0);
  const pathnameRef = useRef(pathname);
  const prefsRef = useRef(prefs);
  const conversationsRef = useRef<MobileConversation[]>(conversations.data ?? []);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    conversationsRef.current = conversations.data ?? [];
  }, [conversations.data]);

  useEffect(() => {
    const supabase = getSupabase();

    function showBanner(payload: IncomingBannerPayload) {
      setBanner(payload);
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => setBanner(null), 5_000);
    }

    function resolveContact(conversationId: string): {
      name: string;
      phone: string | null;
      avatarUrl: string | null;
      contactId: string | null;
    } {
      const match = conversationsRef.current.find((row) => row.id === conversationId);
      const contact = match?.contact;
      const name = contactDisplayName(contact?.name, contact?.phone) ?? 'a contact';
      return {
        name,
        phone: contact?.phone ?? null,
        avatarUrl: contact?.avatar_url ?? null,
        contactId: contact?.id ?? null,
      };
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
        viewingConversationId: viewingConversationIdFromPath(pathnameRef.current),
        appInactive: AppState.currentState !== 'active',
        alreadySeen,
        contentType: msg.content_type,
      });
      if (!decision.sound && !decision.toast && !decision.push) return;

      const currentPrefs = prefsRef.current;
      const kind = incomingPreviewKind(msg.content_type, msg.content_text);
      const preview = incomingPreviewText(kind, msg.content_text, INCOMING_PREVIEW_LABELS);
      const contact = resolveContact(msg.conversation_id);
      const title = `New message from ${contact.name}`;
      const payload: IncomingBannerPayload = {
        conversationId: msg.conversation_id,
        title,
        body: preview,
        name: contact.name,
        phone: contact.phone,
        avatarUrl: contact.avatarUrl,
        contactId: contact.contactId,
      };

      if (decision.sound && currentPrefs.sound) {
        const now = Date.now();
        if (now - lastSoundAtRef.current >= INCOMING_SOUND_COOLDOWN_MS) {
          lastSoundAtRef.current = now;
          void playIncomingMessageSound();
        }
      }

      if (decision.toast && AppState.currentState === 'active') {
        showBanner(payload);
      }

      if (decision.push && currentPrefs.push && isExpoGoAndroid()) {
        void presentLocalIncomingNotification(payload);
      }
    }

    const channel = supabase
      .channel('incoming-message-alerts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          void handleInsert(payload.new as Message);
        },
      )
      .subscribe();

    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !prefs.push) {
      const previous = tokenRef.current;
      tokenRef.current = null;
      if (previous) {
        void unregisterExpoPushToken(previous).catch((err) => {
          logger.info('[PUSH] unregister failed', {
            message: err instanceof Error ? err.message : 'unknown',
          });
        });
      }
      return;
    }

    let cancelled = false;
    void getExpoPushToken().then(async (token) => {
      if (cancelled || !token) return;
      tokenRef.current = token;
      try {
        await registerExpoPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
        logger.info('[PUSH] token registered');
      } catch (err) {
        logger.info('[PUSH] register failed', {
          message: err instanceof Error ? err.message : 'unknown',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [prefs.push]);

  useEffect(() => {
    return () => {
      const token = tokenRef.current;
      if (token) {
        void unregisterExpoPushToken(token).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const received = Notifications.addNotificationResponseReceivedListener((response) => {
      openConversationFromNotificationResponse(response, openConversation);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      openConversationFromNotificationResponse(response, openConversation);
      void Notifications.clearLastNotificationResponseAsync();
    });

    return () => {
      received.remove();
    };
  }, []);

  return banner ? (
    <IncomingMessageBanner payload={banner} onDismiss={() => setBanner(null)} />
  ) : null;
}

export function IncomingAlertsHost({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return (
    <>
      {children}
      {session ? <IncomingAlertsRuntime /> : null}
    </>
  );
}
