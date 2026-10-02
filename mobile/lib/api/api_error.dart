enum ApiErrorKind {
  unauthorized,
  forbidden,
  notFound,
  server,
  timeout,
  offline,
  malformed,
  unknown,
}

class ApiError implements Exception {
  ApiError(this.status, this.message, {String? code, ApiErrorKind? kind})
      : code = code ?? 'http_$status',
        kind = kind ?? classifyApiError(status, code);

  final int status;
  final String message;
  final String code;
  final ApiErrorKind kind;

  bool get isSuspended => status == 403 && code == 'account_suspended';

  @override
  String toString() => message;
}

ApiErrorKind classifyApiError(int status, String? code) {
  if (code == 'timeout' || status == 408) return ApiErrorKind.timeout;
  if (code == 'offline' || code == 'network') return ApiErrorKind.offline;
  if (code == 'malformed') return ApiErrorKind.malformed;
  if (status == 401) return ApiErrorKind.unauthorized;
  if (status == 403) return ApiErrorKind.forbidden;
  if (status == 404) return ApiErrorKind.notFound;
  if (status >= 500) return ApiErrorKind.server;
  return ApiErrorKind.unknown;
}

bool isOfflineApiError(Object error) {
  return error is ApiError &&
      (error.kind == ApiErrorKind.offline || error.kind == ApiErrorKind.timeout);
}
