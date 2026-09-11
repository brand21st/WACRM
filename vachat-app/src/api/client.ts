import { getPublicEnv } from '@/constants/env';
import { ApiError } from '@/lib/api-error';
import { logger } from '@/lib/logger';
import { createSingleFlight } from '@/lib/single-flight';
import { getSupabase } from '@/lib/supabase';

const DEFAULT_TIMEOUT_MS = 15_000;

type JsonErrorBody = {
  error?: string | { code?: string; message?: string };
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
  quiet?: boolean;
};

function parseErrorBody(raw: unknown): { message: string; code?: string } {
  if (!raw || typeof raw !== 'object') {
    return { message: 'Request failed' };
  }
  const error = (raw as JsonErrorBody).error;
  if (typeof error === 'string' && error.trim()) {
    return { message: error };
  }
  if (error && typeof error === 'object') {
    const message = typeof error.message === 'string' && error.message.trim() ? error.message : 'Request failed';
    const code = typeof error.code === 'string' ? error.code : undefined;
    return { message, code };
  }
  return { message: 'Request failed' };
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.message === 'Timeout';
}

function mergeSignals(timeoutMs: number, caller?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    controller.abort(caller?.reason);
  };

  if (caller) {
    if (caller.aborted) {
      controller.abort(caller.reason);
    } else {
      caller.addEventListener('abort', onCallerAbort);
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    },
  };
}

async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * One refresh at a time. Parallel 401s (account smoke + inbox queries)
 * used to each call refreshSession(), rotate the refresh token twice,
 * then sign the user out.
 */
const refreshAccessToken = createSingleFlight(async (): Promise<string | null> => {
  const { data, error } = await getSupabase().auth.refreshSession();
  if (error || !data.session) {
    await getSupabase().auth.signOut();
    return null;
  }
  return data.session.access_token;
});

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError(response.status, 'Response was not valid JSON', 'malformed', 'malformed');
  }
}

async function request<T>(path: string, options: RequestOptions = {}, didRefresh = false): Promise<T> {
  const { apiUrl } = getPublicEnv();
  const method = options.method ?? 'GET';
  const isMutation = method !== 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { signal, cleanup } = mergeSignals(timeoutMs, options.signal);
  const started = Date.now();

  try {
    const token = await getAccessToken();
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(`${apiUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });

    const duration = Date.now() - started;
    let payload: unknown = {};
    try {
      payload = await parseJsonBody(response);
    } catch (error) {
      if (error instanceof ApiError && response.ok) {
        logger.error('[API] malformed', { path, status: response.status, duration, message: error.message });
        throw error;
      }
      if (error instanceof ApiError && !response.ok) {
        payload = {};
      } else {
        throw error;
      }
    }

    if (response.status === 401) {
      if (!didRefresh) {
        const nextToken = await refreshAccessToken();
        if (nextToken) {
          return request<T>(path, options, true);
        }
        logger.info('[API] unauthorized', { path, status: 401, duration, message: 'Session expired' });
        throw new ApiError(401, 'Session expired', 'unauthorized', 'unauthorized');
      }
      const parsed = parseErrorBody(payload);
      logger.info('[API] unauthorized', { path, status: 401, duration, message: parsed.message });
      throw new ApiError(401, parsed.message, parsed.code ?? 'unauthorized', 'unauthorized');
    }

    if (!response.ok) {
      const parsed = parseErrorBody(payload);
      const error = new ApiError(response.status, parsed.message, parsed.code);
      logger.error('[API] request failed', {
        path,
        status: response.status,
        duration,
        message: error.message,
      });
      throw error;
    }

    logger.info('[API] ok', { path, status: response.status, duration });
    return payload as T;
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    if (error instanceof ApiError) {
      throw error;
    }
    if (isTimeoutError(error) || (error instanceof Error && error.name === 'AbortError' && !options.signal?.aborted)) {
      if (!options.quiet) {
        logger.info('[API] timeout', { path, message: 'Request timed out' });
      }
      throw new ApiError(408, 'Request timed out', 'timeout', 'timeout');
    }
    if (!options.quiet) {
      logger.info('[API] offline', { path, message: `Network request failed (${apiUrl})` });
    }
    if (isMutation) {
      throw new ApiError(
        0,
        'Could not reach the server. On Expo web, run the CRM with `npm run dev` in the repo root (uses http://127.0.0.1:3000 automatically).',
        'offline',
        'offline',
      );
    }
    throw new ApiError(0, 'Network request failed', 'offline', 'offline');
  } finally {
    cleanup();
  }
}

export function apiGet<T>(
  path: string,
  options: { signal?: AbortSignal; timeoutMs?: number; quiet?: boolean } = {},
): Promise<T> {
  return request<T>(path, { method: 'GET', ...options });
}

export function apiSend<T>(
  path: string,
  options: {
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<T> {
  return request<T>(path, options);
}
