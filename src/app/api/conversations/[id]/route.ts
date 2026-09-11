import { NextResponse } from "next/server";

import { serializeMobileConversation } from "@/lib/api/mobile/conversations";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type { Conversation } from "@/types";

/**
 * GET /api/conversations/[id]  (any member)
 *
 * Session cookie or Bearer user JWT. Foreign / other-account id → 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data, error } = await supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("[api/conversations] read error:", error);
      return NextResponse.json(
        { error: "Failed to load conversation" },
        { status: 500 },
      );
    }
    if (!data) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({
      conversation: serializeMobileConversation(
        normalizeConversation(data as Conversation),
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
