import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

export function ConversationEmpty() {
  return (
    <View style={styles.wrap}>
      <ThemedText type="small" themeColor="textSecondary">
        No messages yet
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: Spacing.four,
  },
});
