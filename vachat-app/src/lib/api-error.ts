export type ApiErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'server'
  | 'timeout'
  | 'offline'
  | 'malformed'
  | 'unknown';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly kind: ApiErrorKind;

  constructor(status: number, message: string, code?: string, kind?: ApiErrorKind) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? `http_${status}`;
    this.kind = kind ?? classifyApiError(status, code);
  }
}

export function classifyApiError(status: number, code?: string): ApiErrorKind {
  if (code === 'timeout' || status === 408) return 'timeout';
  if (code === 'offline' || code === 'network') return 'offline';
  if (code === 'malformed') return 'malformed';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server';
  return 'unknown';
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isOfflineApiError(error: unknown): boolean {
  return isApiError(error) && (error.kind === 'offline' || error.kind === 'timeout');
}
