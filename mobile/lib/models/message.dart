enum SenderType { customer, agent, bot }

enum ContentType {
  text,
  image,
  document,
  audio,
  video,
  location,
  template,
  interactive,
  call,
  order,
}

enum MessageStatus { sending, sent, delivered, read, failed }

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.conversationId,
    required this.senderType,
    this.senderId,
    required this.contentType,
    this.contentText,
    this.mediaUrl,
    this.filename,
    this.fileSize,
    this.mediaType,
    this.templateName,
    this.messageId,
    required this.status,
    required this.createdAt,
    this.replyToMessageId,
    this.interactiveReplyId,
    this.aiGenerated = false,
    this.direction,
  });

  final String id;
  final String conversationId;
  final SenderType senderType;
  final String? senderId;
  final ContentType contentType;
  final String? contentText;
  final String? mediaUrl;
  final String? filename;
  final int? fileSize;
  final String? mediaType;
  final String? templateName;
  final String? messageId;
  final MessageStatus status;
  final String createdAt;
  final String? replyToMessageId;
  final String? interactiveReplyId;
  final bool aiGenerated;
  final String? direction;

  bool get isOutbound => senderType != SenderType.customer || direction == 'outbound';

  factory ChatMessage.fromJson(Map<String, dynamic> json) {
    return ChatMessage(
      id: json['id'] as String,
      conversationId: json['conversation_id'] as String? ?? '',
      senderType: switch (json['sender_type'] as String?) {
        'agent' => SenderType.agent,
        'bot' => SenderType.bot,
        _ => SenderType.customer,
      },
      senderId: json['sender_id'] as String?,
      contentType: parseContentType(json['content_type'] as String?),
      contentText: json['content_text'] as String?,
      mediaUrl: json['media_url'] as String?,
      filename: json['filename'] as String?,
      fileSize: (json['file_size'] as num?)?.toInt(),
      mediaType: json['media_type'] as String?,
      templateName: json['template_name'] as String?,
      messageId: json['message_id'] as String?,
      status: parseMessageStatus(json['status'] as String?),
      createdAt: json['created_at'] as String? ?? '',
      replyToMessageId: json['reply_to_message_id'] as String?,
      interactiveReplyId: json['interactive_reply_id'] as String?,
      aiGenerated: json['ai_generated'] == true,
      direction: json['direction'] as String?,
    );
  }

  ChatMessage copyWith({
    String? id,
    MessageStatus? status,
    String? messageId,
  }) {
    return ChatMessage(
      id: id ?? this.id,
      conversationId: conversationId,
      senderType: senderType,
      senderId: senderId,
      contentType: contentType,
      contentText: contentText,
      mediaUrl: mediaUrl,
      filename: filename,
      fileSize: fileSize,
      mediaType: mediaType,
      templateName: templateName,
      messageId: messageId ?? this.messageId,
      status: status ?? this.status,
      createdAt: createdAt,
      replyToMessageId: replyToMessageId,
      interactiveReplyId: interactiveReplyId,
      aiGenerated: aiGenerated,
      direction: direction,
    );
  }
}

ContentType parseContentType(String? value) {
  switch (value) {
    case 'image':
      return ContentType.image;
    case 'document':
      return ContentType.document;
    case 'audio':
      return ContentType.audio;
    case 'video':
      return ContentType.video;
    case 'location':
      return ContentType.location;
    case 'template':
      return ContentType.template;
    case 'interactive':
      return ContentType.interactive;
    case 'call':
      return ContentType.call;
    case 'order':
      return ContentType.order;
    default:
      return ContentType.text;
  }
}

MessageStatus parseMessageStatus(String? value) {
  switch (value) {
    case 'sending':
      return MessageStatus.sending;
    case 'delivered':
      return MessageStatus.delivered;
    case 'read':
      return MessageStatus.read;
    case 'failed':
      return MessageStatus.failed;
    default:
      return MessageStatus.sent;
  }
}

class MessageReaction {
  const MessageReaction({
    required this.id,
    required this.messageId,
    required this.conversationId,
    required this.actorType,
    this.actorId,
    required this.emoji,
    required this.createdAt,
  });

  final String id;
  final String messageId;
  final String conversationId;
  final String actorType;
  final String? actorId;
  final String emoji;
  final String createdAt;

  factory MessageReaction.fromJson(Map<String, dynamic> json) {
    return MessageReaction(
      id: json['id'] as String,
      messageId: json['message_id'] as String? ?? '',
      conversationId: json['conversation_id'] as String? ?? '',
      actorType: json['actor_type'] as String? ?? 'agent',
      actorId: json['actor_id'] as String?,
      emoji: json['emoji'] as String? ?? '',
      createdAt: json['created_at'] as String? ?? '',
    );
  }
}

class SendMessageBody {
  const SendMessageBody({
    required this.conversationId,
    required this.messageType,
    this.contentText,
    this.mediaUrl,
    this.filename,
    this.templateName,
    this.templateLanguage,
    this.templateParams,
    this.replyToMessageId,
  });

  final String conversationId;
  final String messageType;
  final String? contentText;
  final String? mediaUrl;
  final String? filename;
  final String? templateName;
  final String? templateLanguage;
  final List<String>? templateParams;
  final String? replyToMessageId;

  Map<String, dynamic> toJson() {
    return {
      'conversation_id': conversationId,
      'message_type': messageType,
      if (contentText != null) 'content_text': contentText,
      if (mediaUrl != null) 'media_url': mediaUrl,
      if (filename != null) 'filename': filename,
      if (templateName != null) 'template_name': templateName,
      if (templateLanguage != null) 'template_language': templateLanguage,
      if (templateParams != null) 'template_params': templateParams,
      if (replyToMessageId != null) 'reply_to_message_id': replyToMessageId,
    };
  }
}

class SendMessageResponse {
  const SendMessageResponse({
    required this.success,
    this.messageId,
    this.whatsappMessageId,
  });

  final bool success;
  final String? messageId;
  final String? whatsappMessageId;

  factory SendMessageResponse.fromJson(Map<String, dynamic> json) {
    return SendMessageResponse(
      success: json['success'] != false,
      messageId: json['message_id'] as String?,
      whatsappMessageId: json['whatsapp_message_id'] as String?,
    );
  }
}

class ApprovedTemplate {
  const ApprovedTemplate({
    required this.id,
    required this.name,
    this.language,
    required this.bodyText,
    this.status,
  });

  final String id;
  final String name;
  final String? language;
  final String bodyText;
  final String? status;

  bool get hasVariables => RegExp(r'\{\{\d+\}\}').hasMatch(bodyText);

  factory ApprovedTemplate.fromJson(Map<String, dynamic> json) {
    return ApprovedTemplate(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      language: json['language'] as String?,
      bodyText: json['body_text'] as String? ?? '',
      status: json['status'] as String?,
    );
  }
}
