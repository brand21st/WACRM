import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { CallActionError, setCallingEnabled } from '@/lib/whatsapp/call-actions'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { data, error } = await supabase
      .from('whatsapp_config')
      .select('calling_status, last_calling_error, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { error: 'Failed to load calling settings' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      calling_status: data?.calling_status === 'enabled' ? 'enabled' : 'disabled',
      last_calling_error: data?.last_calling_error ?? null,
      whatsapp_connected: data?.status === 'connected',
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = (await request.json().catch(() => ({}))) as { enabled?: unknown }
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 },
      )
    }

    const result = await setCallingEnabled({
      accountId,
      enabled: body.enabled,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CallActionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
