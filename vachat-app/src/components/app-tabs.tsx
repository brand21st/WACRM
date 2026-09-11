import { TabList, TabListProps, TabSlot, TabTrigger, TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import { SymbolView, SFSymbol } from 'expo-symbols';
import { BlurView } from 'expo-blur';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';

import { useTheme } from '@/hooks/use-theme';
import { useConversations } from '@/features/conversations/use-conversations';

export default function AppTabs() {
  const theme = useTheme();

  return (
    <Tabs>
      <TabSlot style={{ flex: 1 }} />
      <TabList asChild>
        <CustomTabList theme={theme}>
          <TabTrigger name="home" href="/(tabs)/home" asChild>
            <TabButton icon={{ ios: 'storefront', android: 'storefront', web: 'storefront' }} label="Home" />
          </TabTrigger>
          <TabTrigger name="chats" href="/(tabs)/chats" asChild>
            <TabButton icon={{ ios: 'bubble.fill', android: 'chat_bubble', web: 'chat_bubble' }} label="Chats" isChats />
          </TabTrigger>
          <TabTrigger name="calls" href="/(tabs)/calls" asChild>
            <TabButton icon={{ ios: 'phone', android: 'call', web: 'call' }} label="Calls" />
          </TabTrigger>
          <TabTrigger name="contacts" href="/(tabs)/contacts" asChild>
            <TabButton icon={{ ios: 'person.crop.circle', android: 'contacts', web: 'contacts' }} label="Contacts" />
          </TabTrigger>
          <TabTrigger name="settings" href="/(tabs)/settings" asChild>
            <TabButton icon={{ ios: 'gear', android: 'settings', web: 'settings' }} label="Settings" />
          </TabTrigger>
        </CustomTabList>
      </TabList>
    </Tabs>
  );
}

function CustomTabList({ children, theme, ...props }: TabListProps & { theme: Record<string, string> }) {
  const insets = useSafeAreaInsets();
  
  const inner = (
    <View style={[styles.tabListInner, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {children}
    </View>
  );

  return (
    <View style={styles.tabListContainer}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={90} tint="light" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface, opacity: 0.95 }]} />
      )}
      <View style={[StyleSheet.absoluteFill, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.separator }]} />
      {inner}
    </View>
  );
}

function TabButton({ 
  icon, 
  label, 
  isChats,
  isFocused, 
  ...props 
}: TabTriggerSlotProps & { 
  icon: { ios: SFSymbol; android: any; web: any }; 
  label: string; 
  isChats?: boolean;
}) {
  const theme = useTheme();
  const conversations = useConversations();
  const unreadCount = conversations.data?.reduce((acc, c) => acc + c.unread_count, 0) ?? 0;
  
  const color = isFocused ? theme.accentInk : theme.textMuted;
  
  return (
    <Pressable {...props} style={styles.tabButton}>
      <View style={styles.iconContainer}>
        <SymbolView name={icon} size={24} tintColor={color} />
        {isChats && unreadCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: theme.unread }]}>
            <ThemedText style={styles.badgeText}>{unreadCount > 99 ? '99+' : unreadCount}</ThemedText>
          </View>
        ) : null}
      </View>
      <ThemedText style={[styles.tabLabel, { color }]}>{label}</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabListContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -1 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
  },
  tabListInner: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
  },
  tabButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 56,
    minHeight: 44,
    gap: 2,
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '500',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
});
