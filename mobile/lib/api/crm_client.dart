import 'dart:async';

import 'package:dio/dio.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/env.dart';
import 'api_error.dart';

class CrmClient {
  CrmClient({required this.env, required this.supabase})
      : _dio = Dio(
          BaseOptions(
            baseUrl: env.apiUrl,
            connectTimeout: const Duration(seconds: 15),
            receiveTimeout: const Duration(seconds: 15),
            sendTimeout: const Duration(seconds: 15),
            headers: const {'Content-Type': 'application/json'},
          ),
        );

  final PublicEnv env;
  final SupabaseClient supabase;
  final Dio _dio;
  Future<String?>? _refreshInFlight;

  Future<T> get<T>(String path, {bool quiet = false}) {
    return request<T>(path, method: 'GET', quiet: quiet);
  }

  Future<T> send<T>(
    String path, {
    required String method,
    Object? body,
    bool quiet = false,
  }) {
    return request<T>(path, method: method, body: body, quiet: quiet);
  }

  Future<T> request<T>(
    String path, {
    String method = 'GET',
    Object? body,
    bool quiet = false,
    bool didRefresh = false,
  }) async {
    try {
      final token = supabase.auth.currentSession?.accessToken;
      final response = await _dio.request<dynamic>(
        path,
        data: body,
        options: Options(
          method: method,
          headers: {
            if (token != null) 'Authorization': 'Bearer $token',
          },
        ),
      );
      return _decode<T>(response.data);
    } on DioException catch (error) {
      final status = error.response?.statusCode ?? 0;
      if (status == 401 && !didRefresh) {
        final next = await _refreshAccessToken();
        if (next != null) {
          return request<T>(
            path,
            method: method,
            body: body,
            quiet: quiet,
            didRefresh: true,
          );
        }
        throw ApiError(401, 'Session expired', code: 'unauthorized');
      }
      if (error.type == DioExceptionType.connectionTimeout ||
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.sendTimeout) {
        throw ApiError(408, 'Request timed out', code: 'timeout');
      }
      if (error.type == DioExceptionType.connectionError || status == 0) {
        throw ApiError(0, 'Network request failed', code: 'offline');
      }
      final parsed = _parseError(error.response?.data);
      throw ApiError(status, parsed.message, code: parsed.code);
    }
  }

  Future<String?> _refreshAccessToken() {
    final existing = _refreshInFlight;
    if (existing != null) return existing;
    final future = () async {
      try {
        final result = await supabase.auth.refreshSession();
        if (result.session == null) {
          await supabase.auth.signOut();
          return null;
        }
        return result.session!.accessToken;
      } catch (_) {
        await supabase.auth.signOut();
        return null;
      } finally {
        _refreshInFlight = null;
      }
    }();
    _refreshInFlight = future;
    return future;
  }

  T _decode<T>(dynamic data) {
    if (data is T) return data;
    if (data is Map && T.toString().contains('Map<String, dynamic>')) {
      return Map<String, dynamic>.from(data) as T;
    }
    return data as T;
  }

  ({String message, String? code}) _parseError(dynamic raw) {
    if (raw is Map) {
      final error = raw['error'];
      if (error is String && error.trim().isNotEmpty) {
        return (message: error, code: raw['code'] as String?);
      }
      if (error is Map) {
        final message = error['message'] as String? ?? 'Request failed';
        final code = error['code'] as String?;
        return (message: message, code: code);
      }
    }
    return (message: 'Request failed', code: null);
  }
}
