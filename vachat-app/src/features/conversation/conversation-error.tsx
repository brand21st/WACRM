import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { goBackToChats } from '@/features/conversation/go-back-to-chats';
import { isApiError } from '@/lib/api-error';
import { useTheme } from '@/hooks/use-theme';

function messageFor(error: unknown, notFound: boolean): string {
  if (notFound) return 'Conversation not found';
  if (isApiError(error)) {
    if (error.kind === 'not_found') return 'Conversation not found';
    if (error.kind === 'offline') return 'Check your connection and try again.';
    if (error.kind === 'timeout') return 'The request timed out.';
    if (error.kind === 'forbidden') return 'You don’t have access to this conversation.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Could not load this conversation.';
}

export function ConversationError({
  error,
  notFound,
  onRetry,
  title,
}: {
  error?: unknown;
  notFound?: boolean;
  onRetry?: () => void;
  title?: string;
}) {
  const theme = useTheme();
  const showBack = notFound || (isApiError(error) && error.kind === 'not_found');

  return (
    <View style={styles.wrap}>
      <ThemedText type="subtitle" style={styles.title}>
        {title ?? (showBack ? 'Conversation not found' : 'Couldn’t load messages')}
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.body}>
        {messageFor(error, Boolean(notFound))}
      </ThemedText>
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          onPress={goBackToChats}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
          <ThemedText style={{ color: theme.unreadOnAccent }} type="smallBold">
            Back
          </ThemedText>
        </Pressable>
      ) : onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 }]}>
          <ThemedText style={{ color: theme.unreadOnAccent }} type="smallBold">
            Retry
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
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
  button: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    marginTop: Spacing.three,
    minHeight: 44,
    minWidth: 120,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
});
