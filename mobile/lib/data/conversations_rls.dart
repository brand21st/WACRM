import 'package:supabase_flutter/supabase_flutter.dart';

import '../api/ai_api.dart';
import '../api/api_error.dart';
import '../models/conversation.dart';

const _conversationSelect =
    '*, channel, contact:contacts(id, phone, name, email, company, avatar_url, channel, channel_user_id)';

String? _expiresAt(Map<String, dynamic> row) {
  final column = row['customer_service_expires_at'] as String?;
  if (column != null) {
    final date = DateTime.tryParse(column);
    return date?.toUtc().toIso8601String();
  }
  final last = row['last_customer_message_at'] as String?;
  if (last == null) return null;
  final start = DateTime.tryParse(last);
  if (start == null) return null;
  return start.add(const Duration(hours: 24)).toUtc().toIso8601String();
}

MobileConversation mapConversationRow(Map<String, dynamic> row) {
  final mapped = Map<String, dynamic>.from(row);
  mapped['customer_service_expires_at'] = _expiresAt(row);
  return MobileConversation.fromJson(mapped);
}

Future<MobileConversationContact?> _loadContact(
  SupabaseClient supabase,
  String? contactId,
) async {
  if (contactId == null) return null;
  final data = await supabase
      .from('contacts')
      .select('id, phone, name, email, company, avatar_url, channel, channel_user_id')
      .eq('id', contactId)
      .maybeSingle();
  if (data == null) return null;
  return MobileConversationContact.fromJson(data);
}

Future<MobileConversation> loadConversationViaRls(
  SupabaseClient supabase,
  String id,
) async {
  try {
    final withContact = await supabase
        .from('conversations')
        .select(_conversationSelect)
        .eq('id', id)
        .maybeSingle();
    if (withContact != null) return mapConversationRow(withContact);
  } catch (_) {}

  final plain = await supabase.from('conversations').select().eq('id', id).maybeSingle();
  if (plain == null) {
    throw ApiError(404, 'Conversation not found', code: 'not_found');
  }
  final mapped = mapConversationRow(plain);
  if (mapped.contact != null) return mapped;
  return mapped.copyWith(contact: await _loadContact(supabase, plain['contact_id'] as String?));
}

Future<List<MobileConversation>> loadConversationsViaRls(SupabaseClient supabase) async {
  try {
    final rows = await supabase
        .from('conversations')
        .select(_conversationSelect)
        .order('last_message_at', ascending: false)
        .order('created_at', ascending: false)
        .limit(100);
    return (rows as List).whereType<Map<String, dynamic>>().map(mapConversationRow).toList();
  } catch (_) {}

  final rows = await supabase
      .from('conversations')
      .select()
      .order('last_message_at', ascending: false)
      .order('created_at', ascending: false)
      .limit(100);
  final list = (rows as List).whereType<Map<String, dynamic>>().toList();
  final out = <MobileConversation>[];
  for (final row in list) {
    final mapped = mapConversationRow(row);
    if (mapped.contact != null) {
      out.add(mapped);
    } else {
      out.add(mapped.copyWith(contact: await _loadContact(supabase, row['contact_id'] as String?)));
    }
  }
  return out;
}

Future<AutoreplyResult> setConversationAutoreplyViaRls(
  SupabaseClient supabase, {
  required String conversationId,
  required bool paused,
  bool assignToMe = false,
}) async {
  final userId = supabase.auth.currentUser?.id;
  if (userId == null) {
    throw ApiError(401, 'Session expired', code: 'unauthorized');
  }
  final update = <String, dynamic>{'ai_autoreply_disabled': paused};
  if (paused) {
    if (assignToMe) update['assigned_agent_id'] = userId;
  } else {
    update['assigned_agent_id'] = null;
    update['ai_reply_count'] = 0;
    update['ai_handoff_summary'] = null;
  }
  await supabase.from('conversations').update(update).eq('id', conversationId);
  final conversation = await loadConversationViaRls(supabase, conversationId);
  return AutoreplyResult(success: true, paused: paused, conversation: conversation);
}
