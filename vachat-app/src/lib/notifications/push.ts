import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';

import { apiSend } from '@/api/client';

export const INCOMING_PUSH_CHANNEL = 'incoming-messages';
export const INCOMING_SOUND_FILE = 'incoming.wav';

export type IncomingBannerPayload = {
  conversationId: string;
  title: string;
  body: string;
  name: string;
  phone?: string | null;
  avatarUrl?: string | null;
  contactId?: string | null;
};

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const active = AppState.currentState === 'active';
      return {
        shouldPlaySound: !active,
        shouldSetBadge: true,
        shouldShowBanner: !active,
        shouldShowList: !active,
      };
    },
  });
}

export function conversationIdFromNotificationData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = (data as { conversationId?: unknown }).conversationId;
  return typeof value === 'string' && value ? value : null;
}

export function isExpoGoAndroid(): boolean {
  return Platform.OS === 'android' && Constants.appOwnership === 'expo';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(INCOMING_PUSH_CHANNEL, {
    name: 'Incoming messages',
    importance: Notifications.AndroidImportance.HIGH,
    sound: INCOMING_SOUND_FILE,
    vibrationPattern: [0, 220, 160, 220],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
}

export async function requestIncomingNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const next = await Notifications.requestPermissionsAsync();
    status = next.status;
  }
  return status === 'granted';
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!Device.isDevice && Platform.OS === 'ios') return null;
  const granted = await requestIncomingNotificationPermission();
  if (!granted) return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    // Expo Go on Android cannot mint a remote push token (SDK 53+).
    return null;
  }
}

export async function registerExpoPushToken(token: string, platform: 'ios' | 'android'): Promise<void> {
  await apiSend('/api/device-push-tokens', {
    method: 'POST',
    body: { expo_push_token: token, platform },
  });
}

export async function unregisterExpoPushToken(token: string): Promise<void> {
  await apiSend('/api/device-push-tokens', {
    method: 'DELETE',
    body: { expo_push_token: token },
  });
}

export async function presentLocalIncomingNotification(payload: IncomingBannerPayload): Promise<void> {
  if (Platform.OS === 'web') return;
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: `incoming-${payload.conversationId}`,
    content: {
      title: payload.title,
      body: payload.body,
      sound: INCOMING_SOUND_FILE,
      data: { conversationId: payload.conversationId },
    },
    trigger: null,
  });
}

export function openConversationFromNotificationResponse(
  response: Notifications.NotificationResponse | null,
  open: (conversationId: string) => void,
): void {
  const conversationId = conversationIdFromNotificationData(
    response?.notification.request.content.data,
  );
  if (conversationId) open(conversationId);
}
