import '../../models/conversation.dart';

enum ChatFilter { all, unread, ai, manual, groups, initiatives }

const chatFilters = <({ChatFilter id, String label})>[
  (id: ChatFilter.all, label: 'All'),
  (id: ChatFilter.unread, label: 'Unread'),
  (id: ChatFilter.ai, label: 'AI'),
  (id: ChatFilter.manual, label: 'Manual'),
  (id: ChatFilter.groups, label: 'Groups'),
  (id: ChatFilter.initiatives, label: 'Initiatives'),
];

bool isManualConversation(MobileConversation conversation) {
  return conversation.aiAutoreplyDisabled || conversation.assignedAgentId != null;
}

bool isAiConversation(MobileConversation conversation) {
  return !conversation.aiAutoreplyDisabled && conversation.assignedAgentId == null;
}

bool matchesConversationSearch(MobileConversation conversation, String query) {
  final needle = query.trim().toLowerCase();
  if (needle.isEmpty) return true;
  final name = conversation.contact?.name?.toLowerCase() ?? '';
  final phone = conversation.contact?.phone?.toLowerCase() ?? '';
  final handle = conversation.contact?.channelUserId?.toLowerCase() ?? '';
  final last = conversation.lastMessageText?.toLowerCase() ?? '';
  return name.contains(needle) ||
      phone.contains(needle) ||
      handle.contains(needle) ||
      last.contains(needle);
}

List<MobileConversation> filterConversations(
  List<MobileConversation> conversations, {
  required ChatFilter filter,
  required String query,
  String? tag,
}) {
  if (filter == ChatFilter.groups || filter == ChatFilter.initiatives) {
    return const [];
  }
  var next = conversations;
  if (tag != null) {
    next = next.where((item) => item.contact?.tags.any((t) => t.name == tag) == true).toList();
  }
  if (filter == ChatFilter.unread) {
    next = next.where((item) => item.unreadCount > 0).toList();
  } else if (filter == ChatFilter.manual) {
    next = next.where(isManualConversation).toList();
  } else if (filter == ChatFilter.ai) {
    next = next.where(isAiConversation).toList();
  }
  return next.where((item) => matchesConversationSearch(item, query)).toList();
}
