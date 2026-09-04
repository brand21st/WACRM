import type { SupabaseClient, User } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/ai/admin-client";
import { createClient } from "@/lib/supabase/server";
import { ForbiddenError, UnauthorizedError } from "./account";
import { isPlatformAdminUser } from "./platform-flag";

export { isMerchantAccountOwner, isPlatformAdminUser } from "./platform-flag";

export interface PlatformAdminContext {
  user: User;
  userId: string;
  /** Service-role client — required for every cross-tenant query. */
  admin: SupabaseClient;
}

export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const ssr = await createClient();
  const {
    data: { user },
    error,
  } = await ssr.auth.getUser();
  if (error || !user) {
    throw new UnauthorizedError();
  }
  if (!isPlatformAdminUser(user)) {
    throw new ForbiddenError("Platform admin required");
  }
  return { user, userId: user.id, admin: supabaseAdmin() };
}
