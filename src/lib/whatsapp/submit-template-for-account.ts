import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import {
  validateTemplatePayload,
  type TemplatePayload,
} from '@/lib/whatsapp/template-validators'

export type SubmitTemplateFailure = {
  ok: false
  status: number
  error: string
  meta_template_id?: string
}

export type SubmitTemplateSuccess = {
  ok: true
  template: Record<string, unknown>
  dry_run: boolean
}

export type SubmitTemplateResult = SubmitTemplateSuccess | SubmitTemplateFailure

function buildUpsertRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: 'DRAFT' | string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    account_id: accountId,
    user_id: userId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    rejection_reason: extras.submissionError ? null : null,
    last_submitted_at: new Date().toISOString(),
  }
}

async function upsertTemplateRow(
  supabase: SupabaseClient,
  row: ReturnType<typeof buildUpsertRow>,
) {
  return supabase
    .from('message_templates')
    .upsert(row, { onConflict: 'user_id,name,language' })
    .select()
    .single()
}

function isTemplatesDryRun(): boolean {
  return (
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'
  )
}

/**
 * Submit a template to Meta for the given account and persist the local row.
 * Callers (API route, ops scripts) map the result to their own response shape.
 */
export async function submitTemplateForAccount(
  supabase: SupabaseClient,
  args: {
    accountId: string
    userId: string
    payload: TemplatePayload
  },
): Promise<SubmitTemplateResult> {
  const { accountId, userId, payload } = args

  if (payload.category === 'Authentication') {
    return {
      ok: false,
      status: 400,
      error:
        'AUTHENTICATION templates are not yet supported here — create them in Meta WhatsApp Manager and use "Sync from Meta".',
    }
  }

  try {
    validateTemplatePayload(payload)
  } catch (e) {
    return {
      ok: false,
      status: 400,
      error: e instanceof Error ? e.message : 'Validation failed.',
    }
  }

  const dryRun = isTemplatesDryRun()
  let metaTemplateId: string
  let metaStatus: string

  if (dryRun) {
    metaTemplateId = `dry-run-${crypto.randomUUID()}`
    metaStatus = 'PENDING'
  } else {
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()
    if (configError || !config) {
      return {
        ok: false,
        status: 400,
        error:
          'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
      }
    }
    if (!config.waba_id) {
      return {
        ok: false,
        status: 400,
        error:
          'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
      }
    }

    const accessToken = decrypt(config.access_token)

    try {
      await ensureImageHeaderHandle(payload, accessToken)
    } catch (e) {
      return {
        ok: false,
        status: 400,
        error: e instanceof Error ? e.message : 'Header image upload failed.',
      }
    }

    const metaPayload = buildMetaTemplatePayload(payload)
    try {
      const meta = await submitMessageTemplate({
        wabaId: config.waba_id,
        accessToken,
        payload: metaPayload,
      })
      metaTemplateId = meta.id
      metaStatus = meta.status
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta submit failed.'
      await upsertTemplateRow(
        supabase,
        buildUpsertRow(accountId, userId, payload, {
          status: 'DRAFT',
          metaTemplateId: null,
          submissionError: message,
        }),
      )
      const isRateLimit = /\b429\b/.test(message)
      return {
        ok: false,
        status: isRateLimit ? 429 : 502,
        error: isRateLimit
          ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
          : message,
      }
    }
  }

  const { data: row, error: upsertErr } = await upsertTemplateRow(
    supabase,
    buildUpsertRow(accountId, userId, payload, {
      status: normalizeStatus(metaStatus),
      metaTemplateId,
      submissionError: null,
    }),
  )

  if (upsertErr) {
    return {
      ok: false,
      status: 500,
      error: `Submitted to Meta but failed to save locally: ${upsertErr.message}. Run "Sync from Meta" to recover.`,
      meta_template_id: metaTemplateId,
    }
  }

  return {
    ok: true,
    template: (row ?? {}) as Record<string, unknown>,
    dry_run: dryRun,
  }
}
