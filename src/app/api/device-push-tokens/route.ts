import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { isExpoPushToken } from "@/lib/notifications/expo-push";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const PLATFORMS = new Set(["ios", "android", "web"]);

function readToken(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { expo_push_token?: unknown }).expo_push_token;
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  return isExpoPushToken(token) ? token : null;
}

function readPlatform(body: unknown): "ios" | "android" | "web" | null {
  if (!body || typeof body !== "object") return null;
  const raw = (body as { platform?: unknown }).platform;
  if (typeof raw !== "string") return null;
  return PLATFORMS.has(raw) ? (raw as "ios" | "android" | "web") : null;
}

/**
 * POST /api/device-push-tokens  (any member)
 * DELETE /api/device-push-tokens
 *
 * Register or drop this install's Expo push token. Device-scoped —
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
    const token = readToken(body);
    const platform = readPlatform(body);
    if (!token || !platform) {
      return NextResponse.json(
        { error: "expo_push_token and platform are required" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.from("device_push_tokens").upsert(
      {
        user_id: ctx.userId,
        account_id: ctx.accountId,
        expo_push_token: token,
        platform,
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
    const token = readToken(body);
    if (!token) {
      return NextResponse.json(
        { error: "expo_push_token is required" },
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
