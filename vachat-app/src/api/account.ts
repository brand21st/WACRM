import { apiGet } from '@/api/client';
import { loadAccountViaRls } from '@/lib/account-rls';
import { isOfflineApiError } from '@/lib/api-error';
import type { MobileAuthResponse } from '@/types/account';

export async function fetchAccount(signal?: AbortSignal): Promise<MobileAuthResponse> {
  try {
    return await apiGet<MobileAuthResponse>('/api/account', { signal, quiet: true });
  } catch (error) {
    try {
      return await loadAccountViaRls();
    } catch {
      throw error;
    }
  }
}
