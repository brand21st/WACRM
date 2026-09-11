import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ContactAvatar } from '@/components/contact-avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import {
  conversationDisplayName,
  isManualConversation,
  isAiConversation,
} from '@/features/conversations/conversation-filters';
import { formatConversationTime } from '@/features/conversations/format-conversation-time';
import { useTheme } from '@/hooks/use-theme';
import type { MobileConversation } from '@/types/conversations';

type ConversationRowProps = {
  conversation: MobileConversation;
  fullAgentOn: boolean;
  onPress: (id: string) => void;
};

function ConversationRowComponent({ conversation, fullAgentOn, onPress }: ConversationRowProps) {
  const theme = useTheme();
  const name = conversationDisplayName(conversation);
  const showManual = isManualConversation(conversation, fullAgentOn);
  const showAi = isAiConversation(conversation, fullAgentOn);
  const unread = conversation.unread_count > 0 ? Math.min(conversation.unread_count, 99) : 0;
  const unreadLabel = conversation.unread_count > 99 ? '99+' : String(unread);
  const preview = conversation.last_message_text?.trim() || 'No messages yet';
  const isVip = conversation.contact?.tags?.some((t) => t.name.toLowerCase() === 'vip');
  const company = conversation.contact?.company;

  const isVoice = preview.toLowerCase().includes('voice note') || conversation.last_message_text?.includes('audio');

  return (
    <Pressable
      accessibilityHint="Opens this conversation"
      accessibilityLabel={`${name}${unread > 0 ? `, ${unreadLabel} unread` : ''}`}
      accessibilityRole="button"
      onPress={() => onPress(conversation.id)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.surfaceLowest },
      ]}>
      <ContactAvatar
        contactId={conversation.contact?.id}
        name={conversation.contact?.name}
        phone={conversation.contact?.phone}
        avatarUrl={conversation.contact?.avatar_url}
        size={48}
        style={styles.avatar}
      />
      <View style={[styles.body, { borderBottomColor: theme.separator }]}>
        <View style={styles.top}>
          <View style={styles.nameRow}>
            <ThemedText numberOfLines={1} style={[styles.name, { color: theme.text }]}>
              {name}
            </ThemedText>
            {isVip && (
              <SymbolView name={{ android: 'verified', ios: 'checkmark.seal.fill', web: 'verified' }} size={14} tintColor={theme.accent} style={styles.vip} />
            )}
            {company && (
              <ThemedText numberOfLines={1} style={[styles.company, { color: theme.textSecondary }]}>
                ({company})
              </ThemedText>
            )}
          </View>
          <ThemedText style={[styles.time, { color: unread > 0 ? theme.accentInk : theme.readTime }]}>
            {formatConversationTime(conversation.last_message_at)}
          </ThemedText>
        </View>
        <View style={styles.bottom}>
          <View style={styles.previewContainer}>
            {showManual && (
              <View style={[styles.manual, { backgroundColor: theme.manualFill }]}>
                <ThemedText style={{ color: theme.manual, fontSize: 10, fontWeight: '600' }}>
                  Manual
                </ThemedText>
              </View>
            )}
            {showAi && !showManual && (
              <SymbolView name={{ android: 'done_all', ios: 'checkmark.message', web: 'done_all' }} size={15} tintColor={theme.readTicks} style={styles.previewIcon} />
            )}
            {isVoice && (
              <SymbolView name={{ android: 'mic', ios: 'mic.fill', web: 'mic' }} size={15} tintColor={theme.accent} style={styles.previewIcon} />
            )}
            
            <ThemedText numberOfLines={1} style={[styles.preview, { color: unread > 0 ? theme.text : theme.textMuted, fontWeight: unread > 0 ? '500' : '400' }]}>
              {showAi && !showManual && <ThemedText style={{ color: theme.accentInk, fontWeight: '500', fontSize: 13 }}>✦ [AI] </ThemedText>}
              {!showAi && !showManual && <ThemedText style={{ color: theme.text, fontWeight: '500', fontSize: 13 }}>You: </ThemedText>}
              {isVoice ? 'Voice note (0:42)' : preview}
            </ThemedText>
          </View>
          {unread > 0 && (
            <View style={[styles.badge, { backgroundColor: theme.unread }]}>
              <ThemedText style={[styles.badgeText, { color: theme.unreadOnAccent }]}>
                {unreadLabel}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

export const ConversationRow = memo(ConversationRowComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 76,
    paddingLeft: Spacing.three,
  },
  avatar: {
    marginRight: 14,
    marginVertical: 14,
  },
  body: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingBottom: 14,
    paddingRight: Spacing.three,
    paddingTop: 14,
  },
  top: {
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: Spacing.one,
  },
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  vip: {
    flexShrink: 0,
  },
  company: {
    fontSize: 12,
    flexShrink: 1,
  },
  time: {
    flexShrink: 0,
    fontSize: 11,
    fontWeight: '600',
  },
  bottom: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: Spacing.two,
    marginTop: 4,
  },
  previewContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  preview: {
    flex: 1,
    fontSize: 13,
  },
  previewIcon: {
    flexShrink: 0,
  },
  manual: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexShrink: 0,
  },
  badge: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 20,
    minWidth: 20,
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
