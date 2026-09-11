import { ApiError } from '@/lib/api-error';
import { getSupabase } from '@/lib/supabase';
import type { MobileAuthResponse } from '@/types/account';
import type { AccountRole } from '@/types/auth';

const ROLES: AccountRole[] = ['owner', 'admin', 'agent', 'viewer'];

function asRole(value: unknown): AccountRole {
  if (typeof value === 'string' && (ROLES as string[]).includes(value)) {
    return value as AccountRole;
  }
  return 'viewer';
}

export async function currentAccountId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.account_id as string | undefined) ?? null;
}

export async function loadAccountViaRls(): Promise<MobileAuthResponse> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new ApiError(401, 'Session expired', 'unauthorized', 'unauthorized');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile?.account_id) throw new ApiError(404, 'Account not found', 'not_found', 'not_found');

  const { data: account } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('id', profile.account_id)
    .maybeSingle();

  return {
    account: {
      id: profile.account_id as string,
      name: (account?.name as string | undefined) || 'Account',
    },
    role: asRole(profile.account_role),
  };
}
