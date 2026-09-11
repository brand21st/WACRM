export type SenderType = 'customer' | 'agent' | 'bot';

export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'location'
  | 'template'
  | 'interactive'
  | 'call'
  | 'order';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type Message = {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id?: string;
  content_type: ContentType;
  content_text?: string;
  media_url?: string;
  filename?: string;
  file_size?: number;
  media_type?: string | null;
  template_name?: string;
  message_id?: string;
  status: MessageStatus;
  created_at: string;
  reply_to_message_id?: string;
  interactive_reply_id?: string;
  interactive_payload?: unknown;
  ai_generated?: boolean;
};

export type ReactionActor = 'customer' | 'agent';

export type MessageReaction = {
  id: string;
  message_id: string;
  conversation_id: string;
  actor_type: ReactionActor;
  actor_id?: string;
  emoji: string;
  created_at: string;
};

export type SendMessageType = 'text' | 'image' | 'video' | 'document' | 'audio' | 'template';

export type SendMessageBody = {
  conversation_id: string;
  message_type: SendMessageType;
  content_text?: string;
  media_url?: string;
  filename?: string;
  template_name?: string;
  template_language?: string;
  template_params?: string[];
  reply_to_message_id?: string;
};

export type SendMessageResponse = {
  success: boolean;
  message_id?: string;
  whatsapp_message_id?: string;
};

export type ApprovedTemplate = {
  id: string;
  name: string;
  language?: string;
  body_text: string;
  status?: string;
};
