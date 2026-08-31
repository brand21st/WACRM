/** PostgREST / Postgres errors when a column is not in the schema yet. */
export function isMissingDbColumn(
  error: { message?: string; code?: string } | null,
  column: string,
) {
  if (!error) return false
  const col = column.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const named = new RegExp(`['"]${col}['"]|\\b${col}\\b`, 'i')
  return (
    ((error.code === '42703' || error.code === 'PGRST204') &&
      named.test(error.message ?? '')) ||
    named.test(error.message ?? '')
  )
}

/** PostgREST / Postgres errors when a table or view is not in the schema yet. */
export function isMissingDbRelation(
  error: { message?: string; code?: string } | null,
  relation: string,
) {
  if (!error) return false
  const name = relation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    new RegExp(name, 'i').test(error.message ?? '')
  )
}

/** PostgREST / Postgres errors when a SQL function is not in the schema yet. */
export function isMissingDbFunction(
  error: { message?: string; code?: string } | null,
  fnName?: string,
) {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  if (!fnName) return false
  const name = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(name, 'i').test(error.message ?? '')
}

/** PostgREST / Postgres errors when migration 046 `client_id` is not applied yet. */
export function isMissingClientIdColumn(error: { message?: string; code?: string } | null) {
  return isMissingDbColumn(error, 'client_id')
}
