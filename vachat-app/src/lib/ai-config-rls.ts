import { currentAccountId } from '@/lib/account-rls';
import { ApiError } from '@/lib/api-error';
import { getSupabase } from '@/lib/supabase';
import type { AiConfigResponse, UpdateAiConfigBody } from '@/types/ai';

export async function loadAiConfigViaRls(): Promise<AiConfigResponse> {
  const accountId = await currentAccountId();
  if (!accountId) return { configured: false };

  const { data, error } = await getSupabase()
    .from('ai_configs')
    .select('provider, model, is_active, auto_reply_enabled, full_agent_enabled')
    .eq('account_id', accountId)
    .maybeSingle();

  if (error || !data) return { configured: false };

  return {
    configured: true,
    is_active: Boolean(data.is_active),
    auto_reply_enabled: Boolean(data.auto_reply_enabled),
    full_agent_enabled: Boolean(data.full_agent_enabled),
    provider: (data.provider as string | null) ?? null,
    model: (data.model as string | null) ?? null,
  };
}

/** Direct write when the HTTP API is unreachable (e.g. Expo web CORS to production). */
export async function updateAiConfigViaRls(body: UpdateAiConfigBody): Promise<AiConfigResponse> {
  const accountId = await currentAccountId();
  if (!accountId) {
    throw new ApiError(401, 'Session expired', 'unauthorized', 'unauthorized');
  }

  const patch: Record<string, unknown> = {
    full_agent_enabled: body.full_agent_enabled,
  };
  if (body.full_agent_enabled) {
    patch.auto_reply_enabled = true;
    patch.is_active = true;
  }
  if (body.auto_reply_enabled !== undefined) {
    patch.auto_reply_enabled = body.auto_reply_enabled;
  }
  if (body.is_active !== undefined) {
    patch.is_active = body.is_active;
  }

  const { error } = await getSupabase()
    .from('ai_configs')
    .update(patch)
    .eq('account_id', accountId);

  if (error) {
    throw new ApiError(500, error.message, 'server', 'server');
  }

  if (body.full_agent_enabled) {
    await getSupabase()
      .from('conversations')
      .update({
        ai_autoreply_disabled: false,
        assigned_agent_id: null,
        ai_handoff_summary: null,
        ai_reply_count: 0,
      })
      .eq('account_id', accountId);
  }

  return loadAiConfigViaRls();
}
