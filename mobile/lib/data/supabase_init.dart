import 'package:supabase_flutter/supabase_flutter.dart';

import '../config/env.dart';

Future<SupabaseClient> initSupabase(PublicEnv env) async {
  await Supabase.initialize(
    url: env.supabaseUrl,
    publishableKey: env.supabaseAnonKey,
    authOptions: const FlutterAuthClientOptions(
      authFlowType: AuthFlowType.pkce,
      autoRefreshToken: true,
      detectSessionInUri: true,
      persistSession: true,
    ),
  );
  return Supabase.instance.client;
}
