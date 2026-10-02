import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../api/crm_client.dart';
import '../config/env.dart';

final envProvider = Provider<PublicEnv>((ref) => Env.read());

final supabaseProvider = Provider<SupabaseClient>((ref) {
  return Supabase.instance.client;
});

final crmClientProvider = Provider<CrmClient>((ref) {
  return CrmClient(
    env: ref.watch(envProvider),
    supabase: ref.watch(supabaseProvider),
  );
});
