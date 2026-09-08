/**
 * Shared integration connection shape returned by every
 * `/api/<integration>/config` GET. Tokens never appear here.
 */
export type IntegrationId = 'google-sheets'

export type IntegrationStatus =
  | 'not_connected'
  | 'connected'
  | 'needs_reconnect'

export interface IntegrationConnection {
  connected: boolean
  status: IntegrationStatus
  accountLabel?: string | null
  detailLabel?: string | null
  lastSyncedAt?: string | null
}

export function emptyConnection(): IntegrationConnection {
  return { connected: false, status: 'not_connected' }
}

export function parseIntegrationConnection(
  data: unknown,
): IntegrationConnection {
  if (!data || typeof data !== 'object') return emptyConnection()
  const o = data as Record<string, unknown>
  const status: IntegrationStatus =
    o.status === 'connected' || o.status === 'needs_reconnect'
      ? o.status
      : 'not_connected'
  return {
    connected: status === 'connected',
    status,
    accountLabel: typeof o.accountLabel === 'string' ? o.accountLabel : null,
    detailLabel: typeof o.detailLabel === 'string' ? o.detailLabel : null,
    lastSyncedAt: typeof o.lastSyncedAt === 'string' ? o.lastSyncedAt : null,
  }
}
