import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../app/providers.dart';
import '../../data/messages_rls.dart';
import '../../models/message.dart';

class MessagesController extends StateNotifier<AsyncValue<List<ChatMessage>>> {
  MessagesController(this._ref, this.conversationId) : super(const AsyncValue.loading()) {
    reload();
  }

  final Ref _ref;
  final String conversationId;

  Future<void> reload() async {
    try {
      final rows = await fetchMessages(_ref.read(supabaseProvider), conversationId);
      state = AsyncValue.data(rows);
    } catch (error, stack) {
      state = AsyncValue.error(error, stack);
    }
  }

  void upsert(ChatMessage message) {
    final current = [...(state.asData?.value ?? const <ChatMessage>[])];
    final index = current.indexWhere((item) => item.id == message.id);
    if (index == -1) {
      current.add(message);
    } else {
      current[index] = message;
    }
    current.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    state = AsyncValue.data(current);
  }

  void replaceId(String localId, ChatMessage next) {
    final current = [...(state.asData?.value ?? const <ChatMessage>[])];
    final index = current.indexWhere((item) => item.id == localId);
    if (index == -1) {
      current.add(next);
    } else {
      current[index] = next;
    }
    state = AsyncValue.data(current);
  }
}

final messagesProvider =
    StateNotifierProvider.family<MessagesController, AsyncValue<List<ChatMessage>>, String>(
  (ref, id) => MessagesController(ref, id),
);

final reactionsProvider = FutureProvider.family<List<MessageReaction>, String>((ref, id) {
  return fetchMessageReactions(ref.read(supabaseProvider), id);
});

final templatesProvider = FutureProvider<List<ApprovedTemplate>>((ref) {
  return fetchApprovedTemplates(ref.read(supabaseProvider));
});

RealtimeChannel inboxRealtimeChannel(SupabaseClient supabase) {
  return supabase.channel('inbox-realtime');
}
