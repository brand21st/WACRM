import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { submitTemplateForAccount } from '@/lib/whatsapp/submit-template-for-account'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

/**
 * Submit a template to Meta for approval AND persist it locally.
 *
 * Auth → validate → (DRY_RUN short-circuit) → POST to Meta → upsert
 * local row by (user_id, name, language).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    let payload: TemplatePayload
    try {
      payload = (await request.json()) as TemplatePayload
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
    }

    const result = await submitTemplateForAccount(supabase, {
      accountId,
      userId,
      payload,
    })

    if (!result.ok) {
      return NextResponse.json(
        result.meta_template_id
          ? { error: result.error, meta_template_id: result.meta_template_id }
          : { error: result.error },
        { status: result.status },
      )
    }

    return NextResponse.json({
      success: true,
      template: result.template,
      dry_run: result.dry_run,
    })
  } catch (error) {
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error submitting template:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to submit template.',
      },
      { status: 500 },
    )
  }
}
