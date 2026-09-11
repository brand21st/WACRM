import { SymbolView } from 'expo-symbols';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ChatHomeHeaderProps = {
  fullAgentOn: boolean;
  canEditAi: boolean;
  aiPending: boolean;
  searchOpen: boolean;
  searchQuery: string;
  onToggleAi: (next: boolean) => void;
  onToggleSearch: () => void;
  onChangeSearch: (value: string) => void;
};

function openMoreMenu() {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Settings', 'Cancel'], cancelButtonIndex: 1 },
      (index) => {
        if (index === 0) router.push('/(tabs)/settings');
      },
    );
    return;
  }
  Alert.alert('More', undefined, [
    { text: 'Settings', onPress: () => router.push('/(tabs)/settings') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

export function ChatHomeHeader({
  fullAgentOn,
  canEditAi,
  aiPending,
  searchOpen,
  searchQuery,
  onToggleAi,
  onToggleSearch,
  onChangeSearch,
}: ChatHomeHeaderProps) {
  const theme = useTheme();
  
  const aiBusy = aiPending;

  return (
    <View style={[styles.wrap, { backgroundColor: theme.surfaceLowest, borderBottomColor: theme.separator }]}>
      <View style={styles.row}>
        <View style={styles.brand}>
          <View style={[styles.logoCircle, { backgroundColor: theme.accent }]}>
            <SymbolView name={{ android: 'chat', ios: 'bubble.fill', web: 'chat' }} size={18} tintColor="#FFFFFF" />
          </View>
          <ThemedText style={[styles.wordmark, { color: theme.accent }]} numberOfLines={1}>
            Vachat
          </ThemedText>
        </View>
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="AI Auto"
            accessibilityRole="switch"
            accessibilityState={{ checked: fullAgentOn, disabled: aiBusy }}
            disabled={aiBusy}
            onPress={() => onToggleAi(!fullAgentOn)}
            style={({ pressed }) => [
              styles.aiPill,
              { backgroundColor: theme.filterBg, borderColor: theme.filterBorder },
              pressed && !aiBusy && { opacity: 0.8, transform: [{ scale: 0.95 }] },
              aiBusy && { opacity: 0.7 },
              !canEditAi && { opacity: 0.85 },
            ]}>
            <ThemedText style={[styles.aiLabel, { color: theme.accentInk }]}>
              AI Auto
            </ThemedText>
            <View
              style={[
                styles.toggleTrack,
                { backgroundColor: fullAgentOn ? theme.accent : '#C5CED6' },
              ]}>
              <View
                style={[
                  styles.toggleThumb,
                  { transform: [{ translateX: fullAgentOn ? 10 : 0 }] },
                ]}
              />
            </View>
          </Pressable>
          <Pressable
            accessibilityLabel="Search conversations"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onToggleSearch}
            style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.separator }]}>
            <SymbolView
              name={{ android: 'search', ios: 'magnifyingglass', web: 'search' }}
              size={20}
              tintColor={theme.textMuted}
            />
          </Pressable>
          <Pressable
            accessibilityLabel="More"
            accessibilityRole="button"
            hitSlop={8}
            onPress={openMoreMenu}
            style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: theme.separator }]}>
            <SymbolView
              name={{ android: 'more_vert', ios: 'ellipsis', web: 'more_vert' }}
              size={20}
              tintColor={theme.textMuted}
            />
          </Pressable>
        </View>
      </View>
      {searchOpen ? (
        <View style={[styles.searchBox, { backgroundColor: theme.backgroundElement }]}>
          <TextInput
            accessibilityLabel="Search chats"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onChangeSearch}
            placeholder="Search name, phone, or message"
            placeholderTextColor={theme.textSecondary}
            style={[styles.searchInput, { color: theme.text }]}
            value={searchQuery}
          />
          {searchQuery ? (
            <Pressable
              accessibilityLabel="Clear search"
              accessibilityRole="button"
              onPress={() => onChangeSearch('')}
              style={styles.clear}>
              <ThemedText type="small" themeColor="textSecondary">
                Clear
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
  },
  row: {
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    height: 56,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  logoCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  aiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 4,
  },
  aiLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  toggleTrack: {
    width: 24,
    height: 14,
    borderRadius: 7,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleThumb: {
    width: 10,
    height: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 5,
    shadowColor: '#000000',
    shadowOpacity: 0.15,
    shadowRadius: 1,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  iconButton: {
    alignItems: 'center',
    height: 36,
    width: 36,
    borderRadius: 18,
    justifyContent: 'center',
  },
  searchBox: {
    alignItems: 'center',
    borderRadius: Spacing.two,
    flexDirection: 'row',
    marginBottom: Spacing.two,
    minHeight: 44,
    paddingHorizontal: Spacing.two,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: Spacing.two,
  },
  clear: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
});
