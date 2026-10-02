class PublicEnv {
  const PublicEnv({
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.apiUrl,
  });

  final String supabaseUrl;
  final String supabaseAnonKey;
  final String apiUrl;

  String get oauthRedirectTo => 'vachatapp://auth/callback';
}

class Env {
  Env._();

  static const defaultSupabaseUrl = 'https://ijfgwiewyniwrqbbqmbz.supabase.co';
  static const defaultSupabaseAnonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqZmd3aWV3eW5pd3JxYmJxbWJ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxOTMzMDIsImV4cCI6MjEwMzc2OTMwMn0.p9piF5iZBJIEucnNMKAzeZXDJHLP4obTJZ-8HrxcP2w';
  static const defaultApiUrl = 'https://cloud.vachat.in';

  static String _defined(String name, String fallback) {
    // Empty --dart-define values (e.g. blank SUPABASE_ANON_KEY in .env) must
    // not wipe the production defaults.
    const empty = '';
    final value = switch (name) {
      'SUPABASE_URL' => const String.fromEnvironment('SUPABASE_URL', defaultValue: empty),
      'SUPABASE_ANON_KEY' =>
        const String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: empty),
      'API_URL' => const String.fromEnvironment('API_URL', defaultValue: empty),
      _ => empty,
    };
    final trimmed = value.trim();
    return trimmed.isEmpty ? fallback : trimmed;
  }

  static PublicEnv read() {
    return PublicEnv(
      supabaseUrl: _defined('SUPABASE_URL', defaultSupabaseUrl),
      supabaseAnonKey: _defined('SUPABASE_ANON_KEY', defaultSupabaseAnonKey),
      apiUrl: _defined('API_URL', defaultApiUrl).replaceAll(RegExp(r'/$'), ''),
    );
  }

  static List<String> missing(PublicEnv env) {
    final missing = <String>[];
    if (env.supabaseUrl.isEmpty) missing.add('SUPABASE_URL');
    if (env.supabaseAnonKey.isEmpty) missing.add('SUPABASE_ANON_KEY');
    if (env.apiUrl.isEmpty) missing.add('API_URL');
    return missing;
  }

  static bool isConfigured(PublicEnv env) => missing(env).isEmpty;
}

String crmPageUrl(String apiUrl, String path) {
  final origin = apiUrl.replaceAll(RegExp(r'/$'), '');
  final suffix = path.startsWith('/') ? path : '/$path';
  return '$origin$suffix';
}

String? authCodeFromCallbackUrl(Uri uri) {
  final fromQuery = uri.queryParameters['code'];
  if (fromQuery != null && fromQuery.isNotEmpty) return fromQuery;
  if (uri.fragment.isEmpty) return null;
  return Uri.splitQueryString(uri.fragment)['code'];
}

String? loginErrorFromCallback(String? code) {
  switch (code) {
    case null:
    case '':
      return null;
    case 'missing_code':
      return 'That sign-in link is missing a code. Request a new one.';
    case 'otp_expired':
      return 'That confirmation link has expired. Request a new one from sign up.';
    case 'exchange_failed':
      return 'That sign-in link is invalid or expired. Request a new one.';
    default:
      return code;
  }
}
