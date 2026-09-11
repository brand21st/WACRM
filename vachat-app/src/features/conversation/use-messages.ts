import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/features/auth/auth-context';
import { getSupabase } from '@/lib/supabase';
import type { ApprovedTemplate, Message, MessageReaction } from '@/types/messages';

export const messagesQueryKey = (conversationId: string) => ['messages', conversationId] as const;
export const reactionsQueryKey = (conversationId: string) =>
  ['message-reactions', conversationId] as const;

export async function fetchMessages(conversationId: string): Promise<Message[]> {
  const { data, error } = await getSupabase()
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function fetchMessageReactions(conversationId: string): Promise<MessageReaction[]> {
  const { data, error } = await getSupabase()
    .from('message_reactions')
    .select('*')
    .eq('conversation_id', conversationId);
  if (error) throw error;
  return (data ?? []) as MessageReaction[];
}

export function useMessages(conversationId: string | undefined) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: messagesQueryKey(conversationId ?? ''),
    queryFn: () => fetchMessages(conversationId!),
    enabled: Boolean(accessToken && conversationId),
  });
}

export function useMessageReactions(conversationId: string | undefined) {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: reactionsQueryKey(conversationId ?? ''),
    queryFn: () => fetchMessageReactions(conversationId!),
    enabled: Boolean(accessToken && conversationId),
  });
}

export function useApprovedTemplates() {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: ['message-templates', 'approved'],
    queryFn: async (): Promise<ApprovedTemplate[]> => {
      const { data, error } = await getSupabase()
        .from('message_templates')
        .select('id, name, language, body_text, status')
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as ApprovedTemplate[];
    },
    enabled: Boolean(accessToken),
  });
}
