import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

function SkeletonBubble({ outgoing }: { outgoing?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.row, outgoing && styles.outgoing]}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: outgoing ? theme.accent : theme.backgroundElement, opacity: 0.35 },
        ]}
      />
    </View>
  );
}

export function ConversationLoading() {
  return (
    <View style={styles.wrap}>
      <SkeletonBubble />
      <SkeletonBubble outgoing />
      <SkeletonBubble />
      <SkeletonBubble outgoing />
      <SkeletonBubble />
      <SkeletonBubble />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  row: {
    alignItems: 'flex-start',
  },
  outgoing: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: 16,
    height: 36,
    width: '62%',
  },
});
