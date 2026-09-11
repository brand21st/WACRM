import { looksLikeApiKey } from "@/lib/api-keys/prefix";

/**
 * Extract a Supabase user access token from an Authorization header.
 *
 * Account-level API keys (`wacrm_live_…`) are rejected here so they
 * cannot be treated as a mobile user JWT. Those keys stay on the
 * `/api/v1` `requireApiKey` path.
 */
export function parseBearerAccessToken(
  authorization: string | null | undefined,
): string | null {
  if (!authorization) return null;
  const match = /^Bearer\s+(\S+)/i.exec(authorization.trim());
  if (!match) return null;
  const token = match[1];
  if (!token || looksLikeApiKey(token)) return null;
  return token;
}
