import { apiGet, apiSend } from '@/api/client';
import { isOfflineApiError } from '@/lib/api-error';
import { loadAiConfigViaRls, updateAiConfigViaRls } from '@/lib/ai-config-rls';
import type { AiConfigResponse, UpdateAiConfigBody } from '@/types/ai';

export async function fetchAiConfig(signal?: AbortSignal): Promise<AiConfigResponse> {
  const viaRls = await loadAiConfigViaRls();
  if (viaRls.configured) {
    return viaRls;
  }

  try {
    return await apiGet<AiConfigResponse>('/api/ai/config', { signal, quiet: true });
  } catch (error) {
    if (!isOfflineApiError(error)) throw error;
    return viaRls;
  }
}

export async function updateAiConfig(body: UpdateAiConfigBody): Promise<AiConfigResponse> {
  // Mobile clients are already authenticated to Supabase. Writing through RLS is
  // reliable on Expo web where cross-origin POSTs to cloud.vachat.in are often
  // blocked even though GET succeeds.
  const updated = await updateAiConfigViaRls(body);

  try {
    await apiSend<{ success?: boolean }>('/api/ai/config', {
      method: 'POST',
      body,
      timeoutMs: 8_000,
    });
  } catch (error) {
    if (!isOfflineApiError(error)) {
      // RLS already persisted the toggle; keep the mobile UI in sync.
      return updated;
    }
  }

  return updated;
}
