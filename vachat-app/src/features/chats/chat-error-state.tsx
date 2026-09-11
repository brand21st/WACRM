import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { isApiError } from '@/lib/api-error';
import { useTheme } from '@/hooks/use-theme';

function messageFor(error: unknown): string {
  if (!isApiError(error)) {
    return error instanceof Error ? error.message : 'Something went wrong';
  }
  switch (error.kind) {
    case 'unauthorized':
      return 'Your session expired. Sign in again.';
    case 'forbidden':
      return 'You don’t have access to these conversations.';
    case 'timeout':
      return 'The request timed out.';
    case 'offline':
      return 'Check your connection and try again.';
    case 'server':
      return 'The server could not load conversations.';
    default:
      return error.message;
  }
}

export function ChatErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <ThemedText type="subtitle" style={styles.title}>
        Couldn’t load chats
      </ThemedText>
      <ThemedText themeColor="textSecondary" style={styles.body}>
        {messageFor(error)}
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retry,
          { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 },
        ]}>
        <ThemedText style={{ color: theme.unreadOnAccent }} type="smallBold">
          Retry
        </ThemedText>
      </Pressable>
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
  retry: {
    borderRadius: Spacing.two,
    marginTop: Spacing.three,
    minHeight: 44,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
});
