import type { SupabaseClient } from '@supabase/supabase-js'

import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

/**
 * Digits-only WhatsApp number from signup metadata (`options.data`)
 * or `user.user_metadata`. Empty / unknown shapes return null.
 */
export function whatsappDigitsFromMetadata(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const digits = sanitizePhoneForMeta(String(raw))
  return digits || null
}

/**
 * Copy a signup WhatsApp number onto `profiles.whatsapp_number`.
 *
 * `handle_new_user` is supposed to do this, but it swallows errors and
 * email-confirm / OAuth land after the insert. Call this with a session
 * so RLS can update the caller's row.
 */
export async function persistProfileWhatsApp(
  supabase: SupabaseClient,
  userId: string,
  raw: unknown,
  options: { onlyIfEmpty?: boolean } = {},
): Promise<void> {
  const digits = whatsappDigitsFromMetadata(raw)
  if (!userId || !digits) return

  let query = supabase
    .from('profiles')
    .update({ whatsapp_number: digits })
    .eq('user_id', userId)

  if (options.onlyIfEmpty !== false) {
    query = query.is('whatsapp_number', null)
  }

  const { error } = await query
  if (error) {
    console.error('[persistProfileWhatsApp]', error.message)
  }
}
