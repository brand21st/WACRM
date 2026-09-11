import type { AccountRole } from '@/types/auth';

/** GET /api/account */
export type MobileAuthResponse = {
  account: { id: string; name: string };
  role: AccountRole;
};
