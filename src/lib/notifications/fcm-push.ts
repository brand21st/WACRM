import { createSign } from "crypto";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function isFcmToken(value: string): boolean {
  const token = value.trim();
  if (token.length < 80) return false;
  if (/^(ExponentPushToken|ExpoPushToken)\[/.test(token)) return false;
  return /^[A-Za-z0-9:_-]+$/.test(token);
}

type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

export function readFcmConfig(): FcmConfig | null {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

function base64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

export async function getFcmAccessToken(config: FcmConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: FCM_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const jwt = `${unsigned}.${sign.sign(config.privateKey, "base64url")}`;
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!response.ok) {
    throw new Error(`FCM token HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("FCM token missing access_token");
  return payload.access_token;
}

export async function sendFcmMessage(input: {
  accessToken: string;
  projectId: string;
  token: string;
  title: string;
  body: string;
  conversationId: string;
}): Promise<{ ok: boolean; unregistered: boolean }> {
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${input.projectId}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token: input.token,
          notification: { title: input.title, body: input.body },
          data: { conversationId: input.conversationId },
          android: {
            priority: "HIGH",
            notification: { channelId: "incoming-messages" },
          },
        },
      }),
    },
  );
  if (response.ok) return { ok: true, unregistered: false };
  const text = await response.text();
  const unregistered =
    response.status === 404 ||
    text.includes("UNREGISTERED") ||
    text.includes("NOT_FOUND");
  if (!unregistered) {
    console.warn("[fcm-push] send failed:", response.status, text.slice(0, 200));
  }
  return { ok: false, unregistered };
}
