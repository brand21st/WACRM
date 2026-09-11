import { NextResponse } from "next/server";

import { serializeMobileConversation } from "@/lib/api/mobile/conversations";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  CONVERSATION_SELECT,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import type { Conversation } from "@/types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function parseLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

/**
 * GET /api/conversations  (any member)
 *
 * Session cookie or Bearer user JWT. Account-scoped list for Expo.
 * Does not use /api/v1 API keys.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const status = url.searchParams.get("status");

    let query = supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .eq("account_id", accountId)
      .order("last_message_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) {
      console.error("[api/conversations] list error:", error);
      return NextResponse.json(
        { error: "Failed to list conversations" },
        { status: 500 },
      );
    }

    const conversations = normalizeConversations(
      (data ?? []) as Conversation[],
    ).map(serializeMobileConversation);

    return NextResponse.json({ conversations });
  } catch (err) {
    return toErrorResponse(err);
  }
}
