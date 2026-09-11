/** Secret prefix on every key. Part of the plaintext, not a secret. */
export const API_KEY_PREFIX = 'wacrm_live_';

/**
 * Structural check that a string looks like one of our keys before
 * we bother hashing + hitting the DB. Cheap reject for obviously
 * malformed `Authorization` headers (e.g. a stale invite token).
 *
 * Kept free of Node builtins so middleware (Edge) can import it.
 */
export function looksLikeApiKey(value: string): boolean {
  return (
    value.startsWith(API_KEY_PREFIX) && value.length > API_KEY_PREFIX.length
  );
}
