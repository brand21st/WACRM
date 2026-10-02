import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../../app/providers.dart';
import '../../models/message.dart';
import '../auth/auth_controller.dart';
import '../chats/conversations_controller.dart';
import 'messages_controller.dart';

class InboxRealtimeHost extends ConsumerStatefulWidget {
  const InboxRealtimeHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<InboxRealtimeHost> createState() => _InboxRealtimeHostState();
}

class _InboxRealtimeHostState extends ConsumerState<InboxRealtimeHost> {
  RealtimeChannel? _channel;
  bool _everConnected = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _sync());
  }

  void _sync() {
    final signedIn = ref.read(authProvider).isSignedIn;
    if (!signedIn) {
      _teardown();
      return;
    }
    if (_channel != null) return;
    final supabase = ref.read(supabaseProvider);
    _channel = supabase
        .channel('inbox-realtime')
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'messages',
          callback: (payload) {
            final row = payload.newRecord;
            if (row.isEmpty) return;
            final message = ChatMessage.fromJson(Map<String, dynamic>.from(row));
            if (message.conversationId.isEmpty) return;
            ref.read(messagesProvider(message.conversationId).notifier).upsert(message);
          },
        )
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: 'public',
          table: 'conversations',
          callback: (payload) {
            final row = payload.newRecord;
            final id = row['id'] as String?;
            if (id == null) return;
            ref.read(conversationsProvider.notifier).applyRealtime(
                  id: id,
                  unreadCount: (row['unread_count'] as num?)?.toInt(),
                  lastMessageText: row['last_message_text'] as String?,
                  lastMessageAt: row['last_message_at'] as String?,
                  assignedAgentId: row['assigned_agent_id'] as String?,
                  aiAutoreplyDisabled: row['ai_autoreply_disabled'] as bool?,
                  customerServiceExpiresAt: row['customer_service_expires_at'] as String?,
                );
          },
        )
        .subscribe((status, error) {
          if (status == RealtimeSubscribeStatus.subscribed) {
            if (_everConnected) {
              ref.read(conversationsProvider.notifier).reload();
            }
            _everConnected = true;
          }
        });
  }

  void _teardown() {
    final channel = _channel;
    _channel = null;
    if (channel != null) {
      ref.read(supabaseProvider).removeChannel(channel);
    }
  }

  @override
  void dispose() {
    _teardown();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(authProvider, (previous, next) {
      if (next.isSignedIn) {
        _sync();
      } else {
        _teardown();
      }
    });
    return widget.child;
  }
}
