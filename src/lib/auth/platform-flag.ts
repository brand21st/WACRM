import type { User } from "@supabase/supabase-js";

export function isPlatformAdminUser(user: User | null | undefined): boolean {
  return user?.app_metadata?.is_platform_admin === true;
}
