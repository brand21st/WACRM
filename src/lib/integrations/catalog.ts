import { Sheet, type LucideIcon } from 'lucide-react'

import type { IntegrationId } from './types'

/**
 * Catalog of Settings → Integrations cards.
 *
 * The Integrations page maps this list. To add a future integration:
 * append a definition here and implement its status/connect/disconnect
 * routes. Do not hard-code provider UI in the Settings page.
 */
export interface IntegrationDefinition {
  id: IntegrationId
  /** next-intl key under Settings.integrations.items */
  i18nKey: string
  icon: LucideIcon
  category: 'data'
  statusUrl: string
  connectUrl: string
  disconnectUrl: string
  /** Query param used by the OAuth callback (`?sheets=connected`). */
  oauthReturnParam: string
}

export const INTEGRATIONS: readonly IntegrationDefinition[] = [
  {
    id: 'google-sheets',
    i18nKey: 'googleSheets',
    icon: Sheet,
    category: 'data',
    statusUrl: '/api/google/sheets/config',
    connectUrl: '/api/google/sheets/oauth/connect',
    disconnectUrl: '/api/google/sheets/config',
    oauthReturnParam: 'sheets',
  },
]
