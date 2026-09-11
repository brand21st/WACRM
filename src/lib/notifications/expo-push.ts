import { supabaseAdmin } from "@/lib/ai/admin-client";
import {
  incomingPreviewKind,
  incomingPreviewText,
  contactDisplayName,
} from "@/lib/notifications/incoming-preview";

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const INCOMING_PUSH_CHANNEL = "incoming-messages";
export const INCOMING_SOUND_FILE = "incoming.wav";
export const EXPO_PUSH_BATCH_SIZE = 100;

const PREVIEW_LABELS = {
  image: "Photo",
  video: "Video",
  audio: "Voice message",
  document: "Document",
  location: "Location",
  interactive: "Reply",
  default: "New message",
} as const;

const EXPO_TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

export function isExpoPushToken(value: string): boolean {
  return EXPO_TOKEN_RE.test(value.trim());
}

export function incomingPushCopy(input: {
  contactName?: string | null;
  contactPhone?: string | null;
  contentType?: string;
  contentText?: string | null;
}): { title: string; body: string } {
  const name =
    contactDisplayName(input.contactName, input.contactPhone) ?? "a contact";
  const kind = incomingPreviewKind(input.contentType, input.contentText);
  return {
    title: `New message from ${name}`,
    body: incomingPreviewText(kind, input.contentText, PREVIEW_LABELS),
  };
}

export type IncomingPushInput = {
  accountId: string;
  conversationId: string;
  contactName?: string | null;
  contactPhone?: string | null;
  contentType?: string;
  contentText?: string | null;
};

type TokenRow = { id: string; expo_push_token: string };

type ExpoTicket = {
  status?: string;
  id?: string;
  message?: string;
  details?: { error?: string };
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function sendExpoBatch(
  tokens: string[],
  title: string,
  body: string,
  conversationId: string,
): Promise<ExpoTicket[]> {
  const messages = tokens.map((to) => ({
    to,
    title,
    body,
    sound: INCOMING_SOUND_FILE,
    channelId: INCOMING_PUSH_CHANNEL,
    priority: "high" as const,
    data: { conversationId },
  }));

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(`Expo push HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data?: ExpoTicket[] };
  return Array.isArray(payload.data) ? payload.data : [];
}

async function dropInvalidTokens(rows: TokenRow[], tickets: ExpoTicket[]) {
  const staleIds: string[] = [];
  for (let i = 0; i < tickets.length; i += 1) {
    const ticket = tickets[i];
    const row = rows[i];
    if (!row || ticket?.status !== "error") continue;
    if (ticket.details?.error === "DeviceNotRegistered") {
      staleIds.push(row.id);
    }
  }
  if (staleIds.length === 0) return;
  const { error } = await supabaseAdmin()
    .from("device_push_tokens")
    .delete()
    .in("id", staleIds);
  if (error) {
    console.warn("[expo-push] failed to drop stale tokens:", error.message);
  }
}

/**
 * Fan out an inbound customer message to every Expo device on the
 * account. Never throws to the caller — webhook ACK must not wait
 * on Apple / Google / Expo.
 */
export async function notifyAccountDevicesOfIncomingMessage(
  input: IncomingPushInput,
): Promise<void> {
  if (!input.accountId || !input.conversationId) return;
  if (input.contentType === "call") return;

  const { data, error } = await supabaseAdmin()
    .from("device_push_tokens")
    .select("id, expo_push_token")
    .eq("account_id", input.accountId);

  if (error) {
    console.warn("[expo-push] token lookup failed:", error.message);
    return;
  }

  const rows = ((data ?? []) as TokenRow[]).filter((row) =>
    isExpoPushToken(row.expo_push_token),
  );
  if (rows.length === 0) return;

  const { title, body } = incomingPushCopy(input);

  for (const batch of chunk(rows, EXPO_PUSH_BATCH_SIZE)) {
    try {
      const tickets = await sendExpoBatch(
        batch.map((row) => row.expo_push_token),
        title,
        body,
        input.conversationId,
      );
      await dropInvalidTokens(batch, tickets);
    } catch (err) {
      console.warn(
        "[expo-push] send failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}
