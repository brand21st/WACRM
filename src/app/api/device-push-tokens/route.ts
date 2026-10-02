import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { isExpoPushToken } from "@/lib/notifications/expo-push";
import { isFcmToken } from "@/lib/notifications/fcm-push";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const PLATFORMS = new Set(["ios", "android", "web"]);
const PROVIDERS = new Set(["expo", "fcm"]);

function readRawToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw =
    (body as { token?: unknown }).token ??
    (body as { expo_push_token?: unknown }).expo_push_token;
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return token.length > 0 ? token : null;
}

function readPlatform(body: unknown): "ios" | "android" | "web" | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { platform?: unknown }).platform;
  if (typeof raw !== "string") return null;
  return PLATFORMS.has(raw) ? (raw as "ios" | "android" | "web") : null;
}

function readProvider(body: unknown, token: string): "expo" | "fcm" | null {
  if (body && typeof body === "object") {
    const raw = (body as { provider?: unknown }).provider;
    if (typeof raw === "string" && PROVIDERS.has(raw)) {
      return raw as "expo" | "fcm";
    }
  }
  if (isExpoPushToken(token)) return "expo";
  if (isFcmToken(token)) return "fcm";
  return null;
}

/**
 * POST /api/device-push-tokens  (any member)
 * DELETE /api/device-push-tokens
 *
 * Register or drop this install's Expo or FCM token. Device-scoped —
 * a teammate's phone is not shared.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(
      `device-push:${ctx.userId}`,
      RATE_LIMITS.devicePush,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const token = readRawToken(body);
    const platform = readPlatform(body);
    const provider = token ? readProvider(body, token) : null;
    const valid =
      token &&
      platform &&
      provider &&
      (provider === "expo" ? isExpoPushToken(token) : isFcmToken(token));
    if (!valid || !token || !platform || !provider) {
      return NextResponse.json(
        { error: "token, provider, and platform are required" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.from("device_push_tokens").upsert(
      {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        expo_push_token: token,
        platform,
        provider,
      },
      { onConflict: "expo_push_token" },
    );

    if (error) {
      console.error("[device-push-tokens POST]", error);
      return NextResponse.json(
        { error: "Failed to register push token" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const body = await request.json().catch(() => null);
    const token = readRawToken(body);
    if (!token) {
      return NextResponse.json(
        { error: "token is required" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase
      .from("device_push_tokens")
      .delete()
      .eq("user_id", ctx.userId)
      .eq("expo_push_token", token);

    if (error) {
      console.error("[device-push-tokens DELETE]", error);
      return NextResponse.json(
        { error: "Failed to remove push token" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
