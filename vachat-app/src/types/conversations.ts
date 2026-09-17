export type ConversationStatus = 'open' | 'pending' | 'closed';

export type ChannelType = 'whatsapp' | 'messenger' | 'instagram';

export type MobileConversationContact = {
  id: string;
  phone: string | null;
  name: string | null;
  channel?: ChannelType;
  channel_user_id?: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  tags: { id: string; name: string; color: string }[];
};

export type MobileConversation = {
  id: string;
  channel?: ChannelType;
  status: ConversationStatus;
  assigned_agent_id: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
  unread_count: number;
  ai_autoreply_disabled: boolean;
  customer_service_expires_at: string | null;
  created_at: string;
  updated_at: string;
  contact: MobileConversationContact | null;
};

export type ConversationsResponse = {
  conversations: MobileConversation[];
};

export type ConversationResponse = {
  conversation: MobileConversation;
};
