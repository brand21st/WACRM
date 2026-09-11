import { useLocalSearchParams } from 'expo-router';

import { ConversationScreen } from '@/features/conversation/conversation-screen';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const conversationId = Array.isArray(id) ? id[0] : id;
  return <ConversationScreen conversationId={conversationId} />;
}
