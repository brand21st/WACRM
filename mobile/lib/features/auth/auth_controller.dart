import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../api/account_api.dart';
import '../../api/api_error.dart';
import '../../app/providers.dart';
import '../../config/env.dart';
import '../../data/account_rls.dart';
import '../../models/account.dart';

class AuthUiState {
  const AuthUiState({
    required this.envOk,
    required this.isLoading,
    this.session,
    this.account,
    this.error,
  });

  final bool envOk;
  final bool isLoading;
  final Session? session;
  final MobileAuthResponse? account;
  final String? error;

  bool get isSignedIn => session != null;

  AuthUiState copyWith({
    bool? envOk,
    bool? isLoading,
    Session? session,
    MobileAuthResponse? account,
    String? error,
    bool clearError = false,
    bool clearSession = false,
  }) {
    return AuthUiState(
      envOk: envOk ?? this.envOk,
      isLoading: isLoading ?? this.isLoading,
      session: clearSession ? null : (session ?? this.session),
      account: clearSession ? null : (account ?? this.account),
      error: clearError ? null : (error ?? this.error),
    );
  }
}

class AuthController extends StateNotifier<AuthUiState> {
  AuthController(this._ref)
      : super(
          AuthUiState(
            envOk: Env.isConfigured(_ref.read(envProvider)),
            isLoading: true,
          ),
        ) {
    _init();
  }

  final Ref _ref;
  StreamSubscription<dynamic>? _authSub;
  bool _bindingAccount = false;

  SupabaseClient get _supabase => _ref.read(supabaseProvider);

  Future<void> _init() async {
    if (!state.envOk) {
      state = state.copyWith(isLoading: false);
      return;
    }
    final session = _supabase.auth.currentSession;
    state = state.copyWith(session: session, isLoading: session == null);
    if (session != null) {
      await _bindAccount();
    } else {
      state = state.copyWith(isLoading: false);
    }
    _authSub = _supabase.auth.onAuthStateChange.listen((data) {
      final next = data.session;
      state = state.copyWith(session: next, clearSession: next == null);
      if (next != null) {
        unawaited(_bindAccount());
      } else {
        state = state.copyWith(isLoading: false, clearSession: true);
      }
    });
  }

  Future<void> _bindAccount() async {
    if (_bindingAccount) return;
    _bindingAccount = true;
    try {
      final client = _ref.read(crmClientProvider);
      final account = await fetchAccount(
        client,
        rlsFallback: () => loadAccountViaRls(_supabase),
      );
      state = state.copyWith(
        account: account,
        isLoading: false,
        clearError: true,
      );
    } on ApiError catch (error) {
      if (error.isSuspended) {
        await _supabase.auth.signOut();
        state = AuthUiState(
          envOk: true,
          isLoading: false,
          error: error.message,
        );
        return;
      }
      state = state.copyWith(isLoading: false, error: error.message);
    } catch (error) {
      state = state.copyWith(isLoading: false, error: error.toString());
    } finally {
      _bindingAccount = false;
    }
  }

  Future<void> signIn({required String email, required String password}) async {
    if (email.trim().isEmpty || password.isEmpty) {
      state = state.copyWith(error: 'Please enter your email and password.');
      return;
    }
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final result = await _supabase.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );
      if (result.session == null) {
        state = state.copyWith(isLoading: false, error: 'Sign in failed');
        return;
      }
      state = state.copyWith(session: result.session);
      await _bindAccount();
    } on AuthException catch (error) {
      state = state.copyWith(isLoading: false, error: error.message);
    } catch (error) {
      state = state.copyWith(isLoading: false, error: error.toString());
    }
  }

  Future<void> signInWithGoogle() async {
    state = state.copyWith(isLoading: true, clearError: true);
    try {
      final started = await _supabase.auth.signInWithOAuth(
        OAuthProvider.google,
        redirectTo: _ref.read(envProvider).oauthRedirectTo,
        authScreenLaunchMode: LaunchMode.externalApplication,
      );
      if (!started) {
        state = state.copyWith(isLoading: false, error: 'Could not start Google sign-in.');
      } else {
        state = state.copyWith(isLoading: false);
      }
    } on AuthException catch (error) {
      state = state.copyWith(isLoading: false, error: error.message);
    } catch (error) {
      state = state.copyWith(isLoading: false, error: error.toString());
    }
  }

  Future<void> handleAuthCallback(Uri uri) async {
    final error = loginErrorFromCallback(uri.queryParameters['error']);
    if (error != null) {
      state = state.copyWith(error: error);
      return;
    }
    final code = authCodeFromCallbackUrl(uri);
    if (code == null || code.isEmpty) return;
    try {
      await _supabase.auth.exchangeCodeForSession(code);
      await _bindAccount();
    } on AuthException catch (err) {
      state = state.copyWith(error: err.message);
    } catch (_) {
      state = state.copyWith(error: loginErrorFromCallback('exchange_failed'));
    }
  }

  Future<void> signOut() async {
    await _supabase.auth.signOut();
    state = AuthUiState(envOk: state.envOk, isLoading: false);
  }

  @override
  void dispose() {
    _authSub?.cancel();
    super.dispose();
  }
}

final authProvider = StateNotifierProvider<AuthController, AuthUiState>((ref) {
  return AuthController(ref);
});
