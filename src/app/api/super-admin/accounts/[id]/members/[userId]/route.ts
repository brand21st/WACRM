import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { isAccountRole } from '@/lib/auth/roles'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface Params {
  params: Promise<{ id: string; userId: string }>
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { admin, userId: callerId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:member:${callerId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id, userId } = await params
    const body = (await request.json().catch(() => null)) as { role?: unknown } | null
    const role = body?.role
    if (!isAccountRole(role) || role === 'owner') {
      return NextResponse.json(
        { error: 'role must be admin, agent, or viewer' },
        { status: 400 },
      )
    }

    const { error } = await admin.rpc('set_member_role', {
      p_user_id: userId,
      p_new_role: role,
    })
    if (error) {
      // RPC is scoped to the caller's account. Platform admin uses a
      // direct update instead when the RPC refuses a cross-tenant write.
      const { data: target } = await admin
        .from('profiles')
        .select('account_id, account_role')
        .eq('user_id', userId)
        .maybeSingle()
      if (!target || target.account_id !== id) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 })
      }
      if (target.account_role === 'owner') {
        return NextResponse.json({ error: 'Cannot change the owner role' }, { status: 400 })
      }
      const { error: upErr } = await admin
        .from('profiles')
        .update({ account_role: role })
        .eq('user_id', userId)
        .eq('account_id', id)
      if (upErr) {
        return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
      }
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { admin, userId: callerId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:member-del:${callerId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id, userId } = await params

    const { data: target } = await admin
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', userId)
      .maybeSingle()
    if (!target || target.account_id !== id) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (target.account_role === 'owner') {
      return NextResponse.json({ error: 'Cannot remove the owner' }, { status: 400 })
    }

    const { error } = await admin.rpc('remove_account_member', { p_user_id: userId })
    if (error) {
      console.error('[super-admin] remove member:', error)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
