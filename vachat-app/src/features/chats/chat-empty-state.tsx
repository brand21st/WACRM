import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { ChatFilter } from '@/features/conversations/conversation-filters';

const COPY: Record<ChatFilter, { title: string; body: string }> = {
  all: {
    title: 'No conversations',
    body: 'Customer chats will appear here when they message you on WhatsApp.',
  },
  unread: {
    title: 'No unread chats',
    body: 'You’re all caught up.',
  },
  ai: {
    title: 'No AI chats',
    body: 'AI-managed conversations appear here when AI Automation is on.',
  },
  manual: {
    title: 'No manual chats',
    body: 'Taken-over conversations appear here when AI Automation is on.',
  },
  groups: {
    title: 'Groups aren’t available yet',
    body: 'Vachat conversations are one-to-one. There is no groups entity in the backend.',
  },
  initiatives: {
    title: 'Initiatives aren’t available yet',
    body: 'This filter is reserved for a future feature. No initiative data exists today.',
  },
};

type ChatEmptyStateProps = {
  filter: ChatFilter;
  hasSearch: boolean;
};

export function ChatEmptyState({ filter, hasSearch }: ChatEmptyStateProps) {
  const copy =
    hasSearch && filter !== 'groups' && filter !== 'initiatives'
      ? { title: 'No matching chats', body: 'Try a different name, phone, or message.' }
      : COPY[filter];

  return (
    <View style={styles.wrap}>
      <ThemedText type="subtitle" style={styles.title}>
        {copy.title}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.body}>
        {copy.body}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.six,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  body: {
    marginTop: Spacing.two,
    textAlign: 'center',
  },
});
