import { NextResponse } from 'next/server'

/** Liveness for Docker / Coolify / Nginx. No auth, no I/O. */
export function GET() {
  return NextResponse.json({ ok: true })
}
