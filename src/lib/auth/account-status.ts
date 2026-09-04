export const ACCOUNT_STATUSES = ['active', 'hold', 'suspended'] as const
export type PlatformAccountStatus = (typeof ACCOUNT_STATUSES)[number]

export function isAccountStatus(value: unknown): value is PlatformAccountStatus {
  return value === 'active' || value === 'hold' || value === 'suspended'
}

export function normalizeAccountStatus(value: unknown): PlatformAccountStatus {
  return isAccountStatus(value) ? value : 'active'
}

export function formatPlanDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}
