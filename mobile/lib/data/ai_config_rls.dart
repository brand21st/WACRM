import 'package:supabase_flutter/supabase_flutter.dart';

import '../api/api_error.dart';
import '../models/ai.dart';
import 'account_rls.dart';

Future<AiConfig> loadAiConfigViaRls(SupabaseClient supabase) async {
  final accountId = await currentAccountId(supabase);
  if (accountId == null) return const AiConfig(configured: false);
  final data = await supabase
      .from('ai_configs')
      .select('provider, model, is_active, auto_reply_enabled, full_agent_enabled')
      .eq('account_id', accountId)
      .maybeSingle();
  if (data == null) return const AiConfig(configured: false);
  return AiConfig.fromJson({...data, 'configured': true});
}

Future<AiConfig> updateAiConfigViaRls(
  SupabaseClient supabase,
  Map<String, dynamic> body,
) async {
  final accountId = await currentAccountId(supabase);
  if (accountId == null) {
    throw ApiError(401, 'Session expired', code: 'unauthorized');
  }
  final patch = <String, dynamic>{
    'full_agent_enabled': body['full_agent_enabled'],
  };
  if (body['full_agent_enabled'] == true) {
    patch['auto_reply_enabled'] = true;
    patch['is_active'] = true;
  }
  if (body.containsKey('auto_reply_enabled')) {
    patch['auto_reply_enabled'] = body['auto_reply_enabled'];
  }
  if (body.containsKey('is_active')) {
    patch['is_active'] = body['is_active'];
  }
  await supabase.from('ai_configs').update(patch).eq('account_id', accountId);
  if (body['full_agent_enabled'] == true) {
    await supabase.from('conversations').update({
      'ai_autoreply_disabled': false,
      'assigned_agent_id': null,
      'ai_handoff_summary': null,
      'ai_reply_count': 0,
    }).eq('account_id', accountId);
  }
  return loadAiConfigViaRls(supabase);
}
