import type { SupabaseClient } from '@supabase/supabase-js'

import { isValidPostBusStatusTransition } from './status'

export interface PostBusStatusExtras {
  external_ref?: string
  notification_type?: string
  merchant_id?: string
  message_id?: string
}

export async function applyPostBusNotificationStatus(
  db: SupabaseClient,
  whatsappMessageId: string,
  incomingStatus: string,
  messageUuid?: string | null,
): Promise<PostBusStatusExtras> {
  const byWamid = await db
    .from('postbus_notifications')
    .select('id, status, external_ref, notification_type, merchant_id, message_id')
    .eq('whatsapp_message_id', whatsappMessageId)
    .maybeSingle()

  let row = byWamid.data
  if (!row && messageUuid) {
    const byMsg = await db
      .from('postbus_notifications')
      .select(
        'id, status, external_ref, notification_type, merchant_id, message_id',
      )
      .eq('message_id', messageUuid)
      .maybeSingle()
    row = byMsg.data
  }
  if (!row) return {}

  if (isValidPostBusStatusTransition(row.status as string, incomingStatus)) {
    await db
      .from('postbus_notifications')
      .update({ status: incomingStatus })
      .eq('id', row.id)
  }

  return {
    external_ref: row.external_ref as string,
    notification_type: row.notification_type as string,
    merchant_id: row.merchant_id as string,
    message_id: (row.message_id as string) ?? messageUuid ?? undefined,
  }
}
