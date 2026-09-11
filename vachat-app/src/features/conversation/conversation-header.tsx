import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, View } from 'react-native';

import { ContactAvatar } from '@/components/contact-avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { goBackToChats } from '@/features/conversation/go-back-to-chats';
import { conversationDisplayName } from '@/features/conversations/conversation-filters';
import { useTheme } from '@/hooks/use-theme';
import type { MobileConversation } from '@/types/conversations';

type ConversationHeaderProps = {
  conversation: MobileConversation;
  onOpenCustomer: () => void;
  onOpenCatalog: () => void;
  onVoiceCall: () => void;
  onMore: () => void;
};

export function ConversationHeader({
  conversation,
  onOpenCustomer,
  onOpenCatalog,
  onVoiceCall,
  onMore,
}: ConversationHeaderProps) {
  const theme = useTheme();
  const name = conversationDisplayName(conversation);
  const isVip = conversation.contact?.tags?.some((t) => t.name.toLowerCase() === 'vip');

  return (
    <View style={[styles.wrap, { backgroundColor: theme.surfaceLowest, borderBottomColor: theme.separator }]}>
      <Pressable
        accessibilityLabel="Back"
        accessibilityRole="button"
        hitSlop={8}
        onPress={goBackToChats}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
        <SymbolView
          name={{ android: 'arrow_back', ios: 'arrow.left', web: 'arrow_back' }}
          size={22}
          tintColor={theme.text}
        />
      </Pressable>
      <Pressable
        accessibilityLabel={`${name}, customer info`}
        accessibilityRole="button"
        onPress={onOpenCustomer}
        style={styles.identity}>
        <View style={styles.avatarWrap}>
          <ContactAvatar
            contactId={conversation.contact?.id}
            name={conversation.contact?.name}
            phone={conversation.contact?.phone}
            avatarUrl={conversation.contact?.avatar_url}
            size={40}
          />
          <View
            style={[
              styles.onlineDot,
              { backgroundColor: theme.accent, borderColor: theme.surfaceLowest },
            ]}
          />
        </View>
        <View style={styles.nameRow}>
          <ThemedText numberOfLines={1} style={[styles.name, { color: theme.text }]} type="smallBold">
            {name}
          </ThemedText>
          {isVip ? (
            <>
              <SymbolView
                name={{ android: 'verified', ios: 'checkmark.seal.fill', web: 'verified' }}
                size={16}
                tintColor={theme.accentInk}
              />
              <View style={[styles.vipBadge, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText style={[styles.vipText, { color: theme.textSecondary }]}>
                  VIP
                </ThemedText>
              </View>
            </>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel="Voice call"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onVoiceCall}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
        <SymbolView
          name={{ android: 'call', ios: 'phone', web: 'call' }}
          size={22}
          tintColor={theme.text}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="Catalog"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onOpenCatalog}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
        <SymbolView
          name={{ android: 'storefront', ios: 'storefront', web: 'storefront' }}
          size={21}
          tintColor={theme.text}
        />
      </Pressable>
      <Pressable
        accessibilityLabel="More"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onMore}
        style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
        <SymbolView
          name={{ android: 'more_vert', ios: 'ellipsis', web: 'more_vert' }}
          size={22}
          tintColor={theme.text}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 56,
    paddingHorizontal: 8,
  },
  icon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  pressed: {
    opacity: 0.65,
  },
  identity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 10,
    minWidth: 0,
    paddingRight: Spacing.one,
  },
  avatarWrap: {
    position: 'relative',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  nameRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  vipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  vipText: {
    fontSize: 10,
    fontWeight: '500',
    lineHeight: 12,
  },
});
