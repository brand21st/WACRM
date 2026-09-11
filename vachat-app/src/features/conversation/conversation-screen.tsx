import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/features/account/use-account';
import { useAiConfig } from '@/features/ai/use-ai-config';
import { CatalogSheet } from '@/features/conversation/catalog-sheet';
import { ConversationError } from '@/features/conversation/conversation-error';
import { ConversationHeader } from '@/features/conversation/conversation-header';
import { ConversationLoading } from '@/features/conversation/conversation-loading';
import { ConversationStatusBar } from '@/features/conversation/conversation-status';
import { copyToClipboard } from '@/features/conversation/copy-text';
import { CustomerInfoSheet } from '@/features/conversation/customer-info-sheet';
import { isWindowExpired } from '@/features/conversation/format-window-remaining';
import { MessageComposer } from '@/features/conversation/message-composer';
import { MessageList } from '@/features/conversation/message-list';
import { MessageReactionMenu } from '@/features/conversation/message-reaction-menu';
import { messagePreview } from '@/features/conversation/message-preview';
import { useConversation } from '@/features/conversation/use-conversation';
import { useBusinessAvatarUrl } from '@/features/conversation/use-business-avatar';
import { useMarkConversationRead } from '@/features/conversation/use-mark-conversation-read';
import { useMessageReactions, useMessages } from '@/features/conversation/use-messages';
import { useReactToMessage } from '@/features/conversation/use-react-to-message';
import { useSendMessage } from '@/features/conversation/use-send-message';
import { useToggleConversationAi } from '@/features/conversation/use-toggle-conversation-ai';
import { RealtimeBanner } from '@/features/realtime/realtime-banner';
import { useReactionRealtime } from '@/features/realtime/use-reaction-realtime';
import { isManualConversation } from '@/features/conversations/conversation-filters';
import { useTheme } from '@/hooks/use-theme';
import { isApiError } from '@/lib/api-error';
import { isFullAgentOn } from '@/types/ai';
import type { Message, MessageReaction, SendMessageType } from '@/types/messages';

function canActAsAgent(role: string | undefined): boolean {
  return role === 'owner' || role === 'admin' || role === 'agent';
}

function sendTypeFor(message: Message): SendMessageType {
  if (message.content_type === 'template') return 'template';
  if (
    message.content_type === 'image' ||
    message.content_type === 'video' ||
    message.content_type === 'document' ||
    message.content_type === 'audio'
  ) {
    return message.content_type;
  }
  return 'text';
}

export function ConversationScreen({ conversationId }: { conversationId?: string }) {
  const theme = useTheme();
  const account = useAccount();
  const conversationQuery = useConversation(conversationId);
  const messagesQuery = useMessages(conversationId);
  const reactionsQuery = useMessageReactions(conversationId);
  const aiConfig = useAiConfig();
  const send = useSendMessage(conversationId ?? '');
  const react = useReactToMessage(conversationId ?? '');
  const toggleAi = useToggleConversationAi(conversationId ?? '');

  const conversation = conversationQuery.data;
  const businessAvatarUrl = useBusinessAvatarUrl();
  useMarkConversationRead(conversation);
  useReactionRealtime(conversationId);

  const [now, setNow] = useState(0);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionMessage, setActionMessage] = useState<Message | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pendingAiOn, setPendingAiOn] = useState<boolean | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setReplyTo(null);
    setActionMessage(null);
  }, [conversationId]);

  const role = account.data?.role;
  const agentPlus = canActAsAgent(role);
  const isViewer = role === 'viewer';
  const fullAgentOn = isFullAgentOn(aiConfig.data);
  const isManual = conversation ? isManualConversation(conversation, fullAgentOn) : false;
  const displayIsManual = pendingAiOn === null ? isManual : !pendingAiOn;
  const expired = now === 0 ? false : isWindowExpired(conversation?.customer_service_expires_at ?? null, now);

  const messages = messagesQuery.data;
  const messagesById = useMemo(
    () => new Map((messages ?? []).map((item) => [item.id, item])),
    [messages],
  );
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const reaction of reactionsQuery.data ?? []) {
      const list = map.get(reaction.message_id) ?? [];
      list.push(reaction);
      map.set(reaction.message_id, list);
    }
    return map;
  }, [reactionsQuery.data]);

  const onSend = useCallback(
    (payload: Parameters<typeof send.mutate>[0]) => {
      if (!conversationId || !agentPlus) return;
      send.mutate(payload, {
        onError: (error) => {
          const message = isApiError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : 'Could not send that message.';
          Alert.alert('Send failed', message);
        },
      });
    },
    [agentPlus, conversationId, send],
  );

  const onRetrySend = useCallback(
    (message: Message) => {
      onSend({
        message_type: sendTypeFor(message),
        content_text: message.content_text,
        media_url: message.media_url,
        filename: message.filename,
        template_name: message.template_name,
        reply_to_message_id: message.reply_to_message_id,
      });
    },
    [onSend],
  );

  const onCopy = useCallback((message: Message) => {
    const text = messagePreview(message);
    if (!text) return;
    void copyToClipboard(text);
  }, []);

  const onMore = useCallback(() => {
    const phone = conversation?.contact?.phone;
    if (!phone) {
      Alert.alert('No phone number');
      return;
    }
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Copy phone', 'Cancel'], cancelButtonIndex: 1 },
        (index) => {
          if (index === 0) void copyToClipboard(phone);
        },
      );
      return;
    }
    Alert.alert(phone, undefined, [
      { text: 'Copy phone', onPress: () => void copyToClipboard(phone) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [conversation?.contact?.phone]);

  if (!conversationId) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ConversationError notFound />
      </SafeAreaView>
    );
  }

  const conversationMissing =
    conversationQuery.isError &&
    (isApiError(conversationQuery.error) ? conversationQuery.error.kind === 'not_found' : false);

  if (conversationQuery.isError && !conversation) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ConversationError
          error={conversationQuery.error}
          notFound={conversationMissing}
          title={conversationMissing ? undefined : 'Couldn’t load this conversation'}
          onRetry={() => void conversationQuery.refetch()}
        />
      </SafeAreaView>
    );
  }

  if (!conversation) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
        <ConversationLoading />
      </SafeAreaView>
    );
  }

  return (
    <GestureHandlerRootView style={styles.fill}>
      <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.fill}>
          <ConversationHeader
            conversation={conversation}
            onOpenCustomer={() => setInfoOpen(true)}
            onOpenCatalog={() => setCatalogOpen(true)}
            onVoiceCall={() => Alert.alert('Voice call', 'Calling is coming in a later phase.')}
            onMore={onMore}
          />
          <RealtimeBanner />
          <ConversationStatusBar
            fullAgentOn={fullAgentOn}
            isManual={displayIsManual}
            canEditAi={agentPlus}
            aiPending={toggleAi.isPending}
            expiresAt={conversation.customer_service_expires_at}
            now={now}
            onToggleAi={(nextOn) => {
              if (toggleAi.isPending) return;
              if (!agentPlus) {
                Alert.alert('Chat AI', 'You need agent access to change AI for this chat.');
                return;
              }
              if (!fullAgentOn) {
                Alert.alert(
                  'Chat AI',
                  'Turn on AI Auto from the inbox header before controlling AI per chat.',
                );
                return;
              }
              setPendingAiOn(nextOn);
              toggleAi.mutate(nextOn, {
                onSettled: () => setPendingAiOn(null),
                onError: (error) => {
                  const message = isApiError(error)
                    ? error.message
                    : error instanceof Error
                      ? error.message
                      : 'Could not update chat AI.';
                  Alert.alert('Chat AI', message);
                },
              });
            }}
            company={conversation.contact?.company}
          />
          <MessageList
            conversationId={conversationId}
            messages={messages ?? []}
            reactionsByMessage={reactionsByMessage}
            messagesById={messagesById}
            contactAvatar={{
              contactId: conversation.contact?.id,
              name: conversation.contact?.name,
              phone: conversation.contact?.phone,
              avatarUrl: conversation.contact?.avatar_url,
            }}
            agentAvatar={{
              contactId: account.data?.account.id,
              name: account.data?.account.name,
              avatarUrl: businessAvatarUrl,
            }}
            isLoading={messagesQuery.isLoading}
            error={messagesQuery.error}
            onRetryLoad={() => void messagesQuery.refetch()}
            onReply={setReplyTo}
            onLongPress={setActionMessage}
            onRetrySend={onRetrySend}
          />
          <MessageComposer
            conversationId={conversationId}
            canCompose={agentPlus}
            windowExpired={expired}
            isViewer={isViewer}
            replyTo={replyTo}
            onClearReply={() => setReplyTo(null)}
            sending={send.isPending}
            onOpenCatalog={() => setCatalogOpen(true)}
            onSend={onSend}
          />
        </KeyboardAvoidingView>
        <MessageReactionMenu
          visible={Boolean(actionMessage)}
          onClose={() => setActionMessage(null)}
          onReact={(emoji) => {
            if (actionMessage && agentPlus) {
              react.mutate({ messageId: actionMessage.id, emoji });
            }
            setActionMessage(null);
          }}
          onReply={() => {
            if (actionMessage) setReplyTo(actionMessage);
            setActionMessage(null);
          }}
          onCopy={() => {
            if (actionMessage) onCopy(actionMessage);
            setActionMessage(null);
          }}
        />
        <CatalogSheet visible={catalogOpen} enabled={agentPlus} onClose={() => setCatalogOpen(false)} />
        <CustomerInfoSheet
          visible={infoOpen}
          conversation={conversation}
          onClose={() => setInfoOpen(false)}
        />
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  fill: {
    flex: 1,
  },
});
