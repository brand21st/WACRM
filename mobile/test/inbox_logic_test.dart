import 'package:flutter_test/flutter_test.dart';
import 'package:vachat_mobile/config/env.dart';
import 'package:vachat_mobile/data/session_window.dart';
import 'package:vachat_mobile/features/chats/conversation_filters.dart';
import 'package:vachat_mobile/models/conversation.dart';

void main() {
  test('loginErrorFromCallback maps auth callback codes', () {
    expect(loginErrorFromCallback('missing_code'), contains('missing a code'));
    expect(loginErrorFromCallback(null), isNull);
  });

  test('authCodeFromCallbackUrl reads query and fragment', () {
    expect(
      authCodeFromCallbackUrl(Uri.parse('vachatapp://auth/callback?code=abc')),
      'abc',
    );
    expect(
      authCodeFromCallbackUrl(Uri.parse('vachatapp://auth/callback#code=xyz')),
      'xyz',
    );
  });

  test('filterConversations hides groups and keeps unread', () {
    final rows = [
      MobileConversation(
        id: '1',
        status: ConversationStatus.open,
        unreadCount: 2,
        createdAt: '',
        updatedAt: '',
        lastMessageText: 'hello',
        contact: const MobileConversationContact(id: 'c', name: 'Ada', phone: '+1'),
      ),
      MobileConversation(
        id: '2',
        status: ConversationStatus.open,
        unreadCount: 0,
        createdAt: '',
        updatedAt: '',
        contact: const MobileConversationContact(id: 'd', name: 'Bob', phone: '+2'),
      ),
    ];
    expect(filterConversations(rows, filter: ChatFilter.groups, query: ''), isEmpty);
    expect(filterConversations(rows, filter: ChatFilter.unread, query: '').single.id, '1');
    expect(filterConversations(rows, filter: ChatFilter.all, query: 'ada').single.id, '1');
  });

  test('session window expiry', () {
    expect(isWindowExpired(null), isTrue);
    final future = DateTime.now().add(const Duration(hours: 12)).toIso8601String();
    expect(isWindowExpired(future), isFalse);
    expect(formatWindowRemaining(future), contains('h'));
  });
}
