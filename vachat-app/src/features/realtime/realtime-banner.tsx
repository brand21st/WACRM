import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useRealtimeStatus } from '@/features/realtime/realtime-context';
import { useTheme } from '@/hooks/use-theme';

export function RealtimeBanner() {
  const theme = useTheme();
  const { isConnected, everConnected } = useRealtimeStatus();
  if (!everConnected || isConnected) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary">
        Reconnecting…
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
});
