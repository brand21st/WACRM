import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ConversationEmpty } from '@/features/conversation/conversation-empty';
import { ConversationError } from '@/features/conversation/conversation-error';
import { ConversationLoading } from '@/features/conversation/conversation-loading';
import { formatMessageDateLabel } from '@/features/conversation/format-message-time';
import { MessageActions } from '@/features/conversation/message-actions';
import { MessageBubble, type BubbleAvatar } from '@/features/conversation/message-bubble';
import { useTheme } from '@/hooks/use-theme';
import type { Message, MessageReaction } from '@/types/messages';

type ListRow =
  | { type: 'separator'; id: string; label: string }
  | { type: 'message'; message: Message };

function buildRows(messages: Message[]): ListRow[] {
  const rows: ListRow[] = [];
  let lastDay = '';
  for (const message of messages) {
    const day = new Date(message.created_at).toDateString();
    if (day !== lastDay) {
      rows.push({ type: 'separator', id: `d-${day}`, label: formatMessageDateLabel(message.created_at) });
      lastDay = day;
    }
    rows.push({ type: 'message', message });
  }
  return rows;
}

type MessageListProps = {
  conversationId: string;
  messages: Message[];
  reactionsByMessage: Map<string, MessageReaction[]>;
  messagesById: Map<string, Message>;
  contactAvatar?: BubbleAvatar;
  agentAvatar?: BubbleAvatar;
  isLoading: boolean;
  error: unknown;
  onRetryLoad: () => void;
  onReply: (message: Message) => void;
  onLongPress: (message: Message) => void;
  onRetrySend: (message: Message) => void;
};

export function MessageList({
  conversationId,
  messages,
  reactionsByMessage,
  messagesById,
  contactAvatar,
  agentAvatar,
  isLoading,
  error,
  onRetryLoad,
  onReply,
  onLongPress,
  onRetrySend,
}: MessageListProps) {
  const theme = useTheme();
  const listRef = useRef<FlatList<ListRow>>(null);
  const stickToBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | undefined>(undefined);
  const [showJump, setShowJump] = useState(false);
  const [pendingNew, setPendingNew] = useState(false);
  const rows = useMemo(() => buildRows(messages), [messages]);
  const lastMessageId = messages[messages.length - 1]?.id;

  const scrollToLatest = useCallback((animated = false) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  const scheduleScrollToLatest = useCallback(
    (animated = false) => {
      scrollToLatest(animated);
      if (Platform.OS === 'web') {
        requestAnimationFrame(() => scrollToLatest(animated));
        setTimeout(() => scrollToLatest(animated), 100);
      }
    },
    [scrollToLatest],
  );

  useEffect(() => {
    stickToBottomRef.current = true;
    lastMessageIdRef.current = undefined;
    setShowJump(false);
    setPendingNew(false);
  }, [conversationId]);

  useEffect(() => {
    if (messages.length === 0) return;
    if (!stickToBottomRef.current) return;
    scheduleScrollToLatest(false);
  }, [conversationId, messages.length, lastMessageId, scheduleScrollToLatest]);

  useEffect(() => {
    if (!lastMessageId) {
      lastMessageIdRef.current = lastMessageId;
      return;
    }
    if (lastMessageIdRef.current && lastMessageId !== lastMessageIdRef.current && !stickToBottomRef.current) {
      setPendingNew(true);
      setShowJump(true);
    }
    lastMessageIdRef.current = lastMessageId;
  }, [lastMessageId]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const near = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
    stickToBottomRef.current = near;
    if (near) {
      setPendingNew(false);
      setShowJump(false);
      return;
    }
    setShowJump(true);
  }, []);

  const onContentSizeChange = useCallback(() => {
    if (stickToBottomRef.current) {
      scheduleScrollToLatest(false);
    }
  }, [scheduleScrollToLatest]);

  const renderItem = useCallback(
    ({ item }: { item: ListRow }) => {
      if (item.type === 'separator') {
        return (
          <View style={styles.separator}>
            <View style={{ backgroundColor: theme.surfaceLowest, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 }}>
              <ThemedText type="smallBold" style={{ color: theme.textSecondary, fontSize: 11, fontWeight: '500' }}>
                {item.label}
              </ThemedText>
            </View>
          </View>
        );
      }
      const { message } = item;
      const replyTo = message.reply_to_message_id
        ? messagesById.get(message.reply_to_message_id)
        : undefined;
      return (
        <MessageActions onReply={() => onReply(message)}>
          <MessageBubble
            message={message}
            replyTo={replyTo}
            reactions={reactionsByMessage.get(message.id)}
            contactAvatar={contactAvatar}
            agentAvatar={agentAvatar}
            onLongPress={() => onLongPress(message)}
            onRetry={message.status === 'failed' ? () => onRetrySend(message) : undefined}
          />
        </MessageActions>
      );
    },
    [
      agentAvatar,
      contactAvatar,
      messagesById,
      onLongPress,
      onReply,
      onRetrySend,
      reactionsByMessage,
      theme.surfaceLowest,
      theme.textSecondary,
    ],
  );

  if (isLoading && messages.length === 0) {
    return <ConversationLoading />;
  }
  if (error && messages.length === 0) {
    return <ConversationError error={error} onRetry={onRetryLoad} />;
  }

  return (
    <View style={[styles.wrap, { backgroundColor: theme.chatWallpaper }]}>
      <Image
        accessibilityLabel=""
        contentFit="cover"
        pointerEvents="none"
        source={require('@/assets/images/chat-wallpaper-doodle.svg')}
        style={StyleSheet.absoluteFill}
      />
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => (item.type === 'separator' ? item.id : item.message.id)}
        renderItem={renderItem}
        ListEmptyComponent={<ConversationEmpty />}
        contentContainerStyle={rows.length === 0 ? styles.empty : styles.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={onContentSizeChange}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />
      {showJump ? (
        <Pressable
          accessibilityLabel="Jump to latest"
          accessibilityRole="button"
          onPress={() => {
            stickToBottomRef.current = true;
            scrollToLatest(true);
            setPendingNew(false);
            setShowJump(false);
          }}
          style={[styles.jump, { backgroundColor: theme.surfaceLowest, borderColor: theme.separator }]}>
          <SymbolView
            name={{ android: 'arrow_downward', ios: 'arrow.down', web: 'arrow_downward' }}
            size={20}
            tintColor={theme.textSecondary}
          />
          {pendingNew && <View style={[styles.jumpBadge, { backgroundColor: theme.unread }]} />}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  content: {
    paddingBottom: 12,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  empty: {
    flexGrow: 1,
  },
  separator: {
    alignItems: 'center',
    marginVertical: 4,
  },
  jump: {
    alignItems: 'center',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: Spacing.three,
    height: 36,
    width: 36,
    justifyContent: 'center',
    position: 'absolute',
    right: Spacing.three,
  },
  jumpBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
