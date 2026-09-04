import type { User } from "@supabase/supabase-js";

export function isPlatformAdminUser(user: User | null | undefined): boolean {
  return user?.app_metadata?.is_platform_admin === true;
}

/**
 * Signup still inserts a personal `accounts` row for Super Admin.
 * Platform metrics and the accounts list must count merchant tenants only.
 */
export function isMerchantAccountOwner(
  ownerUserId: string | null | undefined,
  platformAdminUserId: string,
): boolean {
  return Boolean(ownerUserId) && ownerUserId !== platformAdminUserId;
}
