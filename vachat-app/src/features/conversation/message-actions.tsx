import { type ReactNode, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type MessageActionsProps = {
  children: ReactNode;
  onReply: () => void;
};

export function MessageActions({ children, onReply }: MessageActionsProps) {
  const theme = useTheme();
  const swipeRef = useRef<Swipeable>(null);

  return (
    <Swipeable
      ref={swipeRef}
      friction={2}
      leftThreshold={48}
      overshootLeft={false}
      onSwipeableOpen={() => {
        swipeRef.current?.close();
        onReply();
      }}
      renderLeftActions={() => (
        <View style={[styles.reply, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            Reply
          </ThemedText>
        </View>
      )}>
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  reply: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
