import 'package:supabase_flutter/supabase_flutter.dart';

import '../api/api_error.dart';
import '../models/account.dart';

Future<String?> currentAccountId(SupabaseClient supabase) async {
  final userId = supabase.auth.currentUser?.id;
  if (userId == null) return null;
  final profile = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', userId)
      .maybeSingle();
  return profile?['account_id'] as String?;
}

Future<MobileAuthResponse> loadAccountViaRls(SupabaseClient supabase) async {
  final userId = supabase.auth.currentUser?.id;
  if (userId == null) {
    throw ApiError(401, 'Session expired', code: 'unauthorized');
  }
  final profile = await supabase
      .from('profiles')
      .select('account_id, account_role')
      .eq('user_id', userId)
      .maybeSingle();
  final accountId = profile?['account_id'] as String?;
  if (accountId == null) {
    throw ApiError(404, 'Account not found', code: 'not_found');
  }
  final account = await supabase
      .from('accounts')
      .select('id, name')
      .eq('id', accountId)
      .maybeSingle();
  return MobileAuthResponse(
    accountId: accountId,
    accountName: account?['name'] as String? ?? 'Account',
    role: parseAccountRole(profile?['account_role'] as String?),
  );
}
