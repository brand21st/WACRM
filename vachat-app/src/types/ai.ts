import type { AccountRole } from '@/types/auth';

export type AiConfigResponse = {
  configured: boolean;
  is_active?: boolean;
  auto_reply_enabled?: boolean;
  full_agent_enabled?: boolean;
  provider?: string | null;
  model?: string | null;
};

export type UpdateAiConfigBody = {
  provider?: string | null;
  model?: string | null;
  full_agent_enabled: boolean;
  auto_reply_enabled?: boolean;
  is_active?: boolean;
};

/** Same derivation as the web inbox: configured && full_agent_enabled. */
export function isFullAgentOn(config: AiConfigResponse | undefined): boolean {
  return Boolean(config?.configured && config.full_agent_enabled);
}

/** Account-level full-agent toggle — admin+ only, same as web inbox. */
export function canEditAccountAiSettings(
  role: AccountRole | undefined,
  config: AiConfigResponse | undefined,
): boolean {
  return Boolean((role === 'owner' || role === 'admin') && config?.configured);
}
