enum ConversationStatus { open, pending, closed }

enum ChannelType { whatsapp, messenger, instagram }

ChannelType parseChannel(String? value) {
  switch (value) {
    case 'messenger':
      return ChannelType.messenger;
    case 'instagram':
      return ChannelType.instagram;
    default:
      return ChannelType.whatsapp;
  }
}

class ContactTag {
  const ContactTag({required this.id, required this.name, required this.color});

  final String id;
  final String name;
  final String color;

  factory ContactTag.fromJson(Map<String, dynamic> json) {
    return ContactTag(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      color: json['color'] as String? ?? '#64748b',
    );
  }
}

class MobileConversationContact {
  const MobileConversationContact({
    required this.id,
    this.phone,
    this.name,
    this.channel,
    this.channelUserId,
    this.email,
    this.company,
    this.avatarUrl,
    this.tags = const [],
  });

  final String id;
  final String? phone;
  final String? name;
  final ChannelType? channel;
  final String? channelUserId;
  final String? email;
  final String? company;
  final String? avatarUrl;
  final List<ContactTag> tags;

  factory MobileConversationContact.fromJson(Map<String, dynamic> json) {
    final tags = (json['tags'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(ContactTag.fromJson)
            .toList() ??
        const <ContactTag>[];
    return MobileConversationContact(
      id: json['id'] as String? ?? '',
      phone: json['phone'] as String?,
      name: json['name'] as String?,
      channel: json['channel'] == null ? null : parseChannel(json['channel'] as String?),
      channelUserId: json['channel_user_id'] as String?,
      email: json['email'] as String?,
      company: json['company'] as String?,
      avatarUrl: json['avatar_url'] as String?,
      tags: tags,
    );
  }

  MobileConversationContact copyWith({List<ContactTag>? tags}) {
    return MobileConversationContact(
      id: id,
      phone: phone,
      name: name,
      channel: channel,
      channelUserId: channelUserId,
      email: email,
      company: company,
      avatarUrl: avatarUrl,
      tags: tags ?? this.tags,
    );
  }
}

const _unset = Object();

class MobileConversation {
  const MobileConversation({
    required this.id,
    this.channel,
    required this.status,
    this.assignedAgentId,
    this.lastMessageText,
    this.lastMessageAt,
    this.unreadCount = 0,
    this.aiAutoreplyDisabled = false,
    this.customerServiceExpiresAt,
    required this.createdAt,
    required this.updatedAt,
    this.contact,
  });

  final String id;
  final ChannelType? channel;
  final ConversationStatus status;
  final String? assignedAgentId;
  final String? lastMessageText;
  final String? lastMessageAt;
  final int unreadCount;
  final bool aiAutoreplyDisabled;
  final String? customerServiceExpiresAt;
  final String createdAt;
  final String updatedAt;
  final MobileConversationContact? contact;

  ChannelType get resolvedChannel =>
      channel ?? contact?.channel ?? ChannelType.whatsapp;

  String get displayName => contact?.name?.trim().isNotEmpty == true
      ? contact!.name!
      : (contact?.phone ?? 'Unknown');

  factory MobileConversation.fromJson(Map<String, dynamic> json) {
    final status = switch (json['status'] as String?) {
      'pending' => ConversationStatus.pending,
      'closed' => ConversationStatus.closed,
      _ => ConversationStatus.open,
    };
    final contactRaw = json['contact'];
    MobileConversationContact? contact;
    if (contactRaw is Map<String, dynamic>) {
      contact = MobileConversationContact.fromJson(contactRaw);
    } else if (contactRaw is List && contactRaw.isNotEmpty && contactRaw.first is Map) {
      contact = MobileConversationContact.fromJson(
        Map<String, dynamic>.from(contactRaw.first as Map),
      );
    }
    return MobileConversation(
      id: json['id'] as String,
      channel: json['channel'] == null ? null : parseChannel(json['channel'] as String?),
      status: status,
      assignedAgentId: json['assigned_agent_id'] as String?,
      lastMessageText: json['last_message_text'] as String?,
      lastMessageAt: json['last_message_at'] as String?,
      unreadCount: (json['unread_count'] as num?)?.toInt() ?? 0,
      aiAutoreplyDisabled: json['ai_autoreply_disabled'] == true,
      customerServiceExpiresAt: json['customer_service_expires_at'] as String?,
      createdAt: json['created_at'] as String? ?? '',
      updatedAt: json['updated_at'] as String? ?? '',
      contact: contact,
    );
  }

  MobileConversation copyWith({
    int? unreadCount,
    Object? lastMessageText = _unset,
    Object? lastMessageAt = _unset,
    Object? assignedAgentId = _unset,
    bool? aiAutoreplyDisabled,
    Object? customerServiceExpiresAt = _unset,
    ConversationStatus? status,
    MobileConversationContact? contact,
  }) {
    return MobileConversation(
      id: id,
      channel: channel,
      status: status ?? this.status,
      assignedAgentId: identical(assignedAgentId, _unset)
          ? this.assignedAgentId
          : assignedAgentId as String?,
      lastMessageText: identical(lastMessageText, _unset)
          ? this.lastMessageText
          : lastMessageText as String?,
      lastMessageAt: identical(lastMessageAt, _unset)
          ? this.lastMessageAt
          : lastMessageAt as String?,
      unreadCount: unreadCount ?? this.unreadCount,
      aiAutoreplyDisabled: aiAutoreplyDisabled ?? this.aiAutoreplyDisabled,
      customerServiceExpiresAt: identical(customerServiceExpiresAt, _unset)
          ? this.customerServiceExpiresAt
          : customerServiceExpiresAt as String?,
      createdAt: createdAt,
      updatedAt: updatedAt,
      contact: contact ?? this.contact,
    );
  }
}
