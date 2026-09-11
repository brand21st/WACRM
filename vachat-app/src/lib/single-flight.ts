/**
 * Coalesce concurrent callers onto one in-flight promise.
 * Used so parallel 401s share a single Supabase refresh instead of
 * rotating the refresh token twice and signing the user out.
 */
export function createSingleFlight<T>(run: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (!inflight) {
      inflight = run().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}
