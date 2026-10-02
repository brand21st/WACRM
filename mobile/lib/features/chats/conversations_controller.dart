import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/conversations_api.dart';
import '../../app/providers.dart';
import '../../data/conversations_rls.dart';
import '../../models/conversation.dart';
import '../auth/auth_controller.dart';

class ConversationsController extends StateNotifier<AsyncValue<List<MobileConversation>>> {
  ConversationsController(this._ref) : super(const AsyncValue.loading()) {
    reload();
  }

  final Ref _ref;

  Future<void> reload() async {
    final auth = _ref.read(authProvider);
    if (!auth.isSignedIn) {
      state = const AsyncValue.data([]);
      return;
    }
    try {
      final client = _ref.read(crmClientProvider);
      final supabase = _ref.read(supabaseProvider);
      final rows = await fetchConversations(
        client,
        rlsFallback: () => loadConversationsViaRls(supabase),
      );
      state = AsyncValue.data(rows);
    } catch (error, stack) {
      state = AsyncValue.error(error, stack);
    }
  }

  void patch(MobileConversation next) {
    final current = state.asData?.value;
    if (current == null) return;
    final index = current.indexWhere((item) => item.id == next.id);
    final copy = [...current];
    if (index == -1) {
      copy.insert(0, next);
    } else {
      copy[index] = next.copyWith(contact: next.contact ?? copy[index].contact);
    }
    copy.sort((a, b) {
      final left = DateTime.tryParse(a.lastMessageAt ?? '')?.millisecondsSinceEpoch ?? 0;
      final right = DateTime.tryParse(b.lastMessageAt ?? '')?.millisecondsSinceEpoch ?? 0;
      return right.compareTo(left);
    });
    state = AsyncValue.data(copy);
  }

  void applyRealtime({
    required String id,
    int? unreadCount,
    String? lastMessageText,
    String? lastMessageAt,
    String? assignedAgentId,
    bool? aiAutoreplyDisabled,
    String? customerServiceExpiresAt,
  }) {
    final current = state.asData?.value;
    if (current == null) return;
    final index = current.indexWhere((item) => item.id == id);
    if (index == -1) {
      reload();
      return;
    }
    final item = current[index];
    patch(
      item.copyWith(
        unreadCount: unreadCount,
        lastMessageText: lastMessageText,
        lastMessageAt: lastMessageAt,
        assignedAgentId: assignedAgentId,
        aiAutoreplyDisabled: aiAutoreplyDisabled,
        customerServiceExpiresAt: customerServiceExpiresAt,
      ),
    );
  }
}

final conversationsProvider =
    StateNotifierProvider<ConversationsController, AsyncValue<List<MobileConversation>>>((ref) {
  return ConversationsController(ref);
});

final conversationProvider = FutureProvider.family<MobileConversation, String>((ref, id) async {
  final list = ref.watch(conversationsProvider).asData?.value;
  MobileConversation? cached;
  if (list != null) {
    for (final item in list) {
      if (item.id == id) {
        cached = item;
        break;
      }
    }
  }
  if (cached != null) return cached;
  final client = ref.read(crmClientProvider);
  final supabase = ref.read(supabaseProvider);
  return fetchConversation(
    client,
    id,
    rlsFallback: () => loadConversationViaRls(supabase, id),
  );
});
