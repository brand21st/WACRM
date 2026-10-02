import 'package:supabase_flutter/supabase_flutter.dart';

import '../models/message.dart';

Future<List<ChatMessage>> fetchMessages(SupabaseClient supabase, String conversationId) async {
  final rows = await supabase
      .from('messages')
      .select()
      .eq('conversation_id', conversationId)
      .order('created_at', ascending: true);
  return (rows as List).whereType<Map<String, dynamic>>().map(ChatMessage.fromJson).toList();
}

Future<List<MessageReaction>> fetchMessageReactions(
  SupabaseClient supabase,
  String conversationId,
) async {
  final rows = await supabase
      .from('message_reactions')
      .select()
      .eq('conversation_id', conversationId);
  return (rows as List).whereType<Map<String, dynamic>>().map(MessageReaction.fromJson).toList();
}

Future<List<ApprovedTemplate>> fetchApprovedTemplates(SupabaseClient supabase) async {
  final rows = await supabase
      .from('message_templates')
      .select('id, name, language, body_text, status')
      .eq('status', 'APPROVED')
      .order('created_at', ascending: false);
  return (rows as List).whereType<Map<String, dynamic>>().map(ApprovedTemplate.fromJson).toList();
}

Future<void> markConversationRead(SupabaseClient supabase, String conversationId) {
  return supabase.from('conversations').update({'unread_count': 0}).eq('id', conversationId);
}
