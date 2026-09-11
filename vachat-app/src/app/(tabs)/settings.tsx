import { Host, Switch } from '@expo/ui';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/features/auth/auth-context';
import { useIncomingAlertPrefs } from '@/features/notifications/use-incoming-alert-prefs';
import { useTheme } from '@/hooks/use-theme';
import { playIncomingMessageSound } from '@/lib/notifications/incoming-sound';
import { requestIncomingNotificationPermission } from '@/lib/notifications/push';

export default function SettingsScreen() {
  const theme = useTheme();
  const { user, signOut } = useAuth();
  const { prefs, setPrefs } = useIncomingAlertPrefs();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissionHint, setPermissionHint] = useState<string | null>(null);

  async function onSignOut() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await signOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
    } finally {
      setPending(false);
    }
  }

  async function onTogglePush(next: boolean) {
    setPrefs({ push: next });
    if (!next) {
      setPermissionHint(null);
      return;
    }
    const granted = await requestIncomingNotificationPermission();
    if (!granted) {
      setPermissionHint('Notifications are blocked. Enable them in system settings.');
    } else {
      setPermissionHint(null);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <ThemedText type="title" style={styles.heading}>
            Settings
          </ThemedText>
          {user?.email ? (
            <ThemedText type="small" themeColor="textSecondary">
              {user.email}
            </ThemedText>
          ) : null}

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Notifications
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Same incoming-message chime and popup as the web inbox, plus a lock-screen push when the
            app is in the background.
          </ThemedText>

          <View style={[styles.row, { backgroundColor: theme.surfaceLowest }]}>
            <View style={styles.rowCopy}>
              <ThemedText type="smallBold">Sound</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Play the two-tone chime on a new customer message.
              </ThemedText>
            </View>
            <Host matchContents>
              <Switch value={prefs.sound} onValueChange={(value) => setPrefs({ sound: value })} />
            </Host>
          </View>

          <View style={[styles.row, { backgroundColor: theme.surfaceLowest }]}>
            <View style={styles.rowCopy}>
              <ThemedText type="smallBold">Push notifications</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                System banner when Vachat is in the background or closed.
              </ThemedText>
            </View>
            <Host matchContents>
              <Switch value={prefs.push} onValueChange={(value) => void onTogglePush(value)} />
            </Host>
          </View>

          {permissionHint ? (
            <ThemedText type="small" style={styles.hint}>
              {permissionHint}
            </ThemedText>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => void playIncomingMessageSound()}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
            ]}>
            <ThemedText type="smallBold">Test sound</ThemedText>
          </Pressable>

          {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
          <Pressable
            accessibilityRole="button"
            disabled={pending}
            onPress={() => void onSignOut()}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: theme.backgroundElement, opacity: pressed || pending ? 0.7 : 1 },
            ]}>
            <ThemedText type="smallBold">Sign Out</ThemedText>
          </Pressable>
        </ScrollView>
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
  },
  scroll: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
  },
  heading: {
    fontSize: 28,
    lineHeight: 34,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
  },
  hint: {
    color: '#C0392B',
  },
  error: {
    color: '#C0392B',
  },
});
