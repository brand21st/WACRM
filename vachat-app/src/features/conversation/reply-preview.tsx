import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { messagePreview, replyAuthorLabel } from '@/features/conversation/message-preview';
import { useTheme } from '@/hooks/use-theme';
import type { Message } from '@/types/messages';

export function ReplyPreview({ message, onCancel }: { message: Message; onCancel: () => void }) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: theme.surface, borderTopColor: theme.separator }]}>
      <View style={[styles.bar, { borderLeftColor: theme.accent }]}>
        <ThemedText numberOfLines={1} type="smallBold">
          Replying to {replyAuthorLabel(message)}
        </ThemedText>
        <ThemedText numberOfLines={1} themeColor="textSecondary" type="small">
          {messagePreview(message)}
        </ThemedText>
      </View>
      <Pressable accessibilityLabel="Cancel reply" accessibilityRole="button" onPress={onCancel} style={styles.cancel}>
        <ThemedText type="smallBold">✕</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  bar: {
    borderLeftWidth: 3,
    flex: 1,
    paddingLeft: Spacing.two,
  },
  cancel: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
});
