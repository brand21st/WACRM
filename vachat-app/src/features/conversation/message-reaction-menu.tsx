import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ModalSheet } from '@/features/conversation/modal-sheet';
import { useTheme } from '@/hooks/use-theme';

export const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

type MessageReactionMenuProps = {
  visible: boolean;
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
};

export function MessageReactionMenu({
  visible,
  onClose,
  onReact,
  onReply,
  onCopy,
}: MessageReactionMenuProps) {
  const theme = useTheme();

  return (
    <ModalSheet
      align="center"
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.card, { backgroundColor: theme.surface, borderColor: theme.separator }]}>
      <View style={styles.emojis}>
        {QUICK_EMOJIS.map((emoji) => (
          <Pressable
            key={emoji}
            accessibilityLabel={`React ${emoji}`}
            accessibilityRole="button"
            onPress={() => onReact(emoji)}
            style={({ pressed }) => [styles.emoji, pressed && styles.pressed]}>
            <ThemedText style={styles.emojiText}>{emoji}</ThemedText>
          </Pressable>
        ))}
      </View>
      <View style={[styles.divider, { backgroundColor: theme.separator }]} />
      <Pressable accessibilityRole="button" onPress={onReply} style={styles.row}>
        <ThemedText type="smallBold">Reply</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={onCopy} style={styles.row}>
        <ThemedText type="smallBold">Copy</ThemedText>
      </Pressable>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 280,
    paddingVertical: Spacing.two,
  },
  emojis: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  emoji: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emojiText: {
    fontSize: 22,
    lineHeight: 28,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: Spacing.one,
  },
  row: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  pressed: {
    opacity: 0.65,
  },
});
