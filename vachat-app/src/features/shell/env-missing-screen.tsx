import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { PublicEnvName } from '@/constants/env';

export function EnvMissingScreen({ missing }: { missing: PublicEnvName[] }) {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Missing configuration</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.body}>
          Copy vachat-app/.env.example to .env and set the public variables. The app will not start
          until they are present.
        </ThemedText>
        <ThemedText type="code">{missing.join('\n')}</ThemedText>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  body: {
    lineHeight: 22,
  },
});
