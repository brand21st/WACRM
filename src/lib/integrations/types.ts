/**
 * Shared integration connection shape returned by every
 * `/api/<integration>/config` GET. Tokens never appear here.
 */
export type IntegrationId = 'google-sheets' | 'postbus'

export type IntegrationStatus =
  | 'not_connected'
  | 'connected'
  | 'needs_reconnect'
  | 'configuration_required'
  | 'error'

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

const STATUSES: readonly IntegrationStatus[] = [
  'not_connected',
  'connected',
  'needs_reconnect',
  'configuration_required',
  'error',
]

export function parseIntegrationConnection(
  data: unknown,
): IntegrationConnection {
  if (!data || typeof data !== 'object') return emptyConnection()
  const o = data as Record<string, unknown>
  const status: IntegrationStatus = STATUSES.includes(
    o.status as IntegrationStatus,
  )
    ? (o.status as IntegrationStatus)
    : 'not_connected'
  return {
    connected: status === 'connected',
    status,
    accountLabel: typeof o.accountLabel === 'string' ? o.accountLabel : null,
    detailLabel: typeof o.detailLabel === 'string' ? o.detailLabel : null,
    lastSyncedAt: typeof o.lastSyncedAt === 'string' ? o.lastSyncedAt : null,
  }
}
