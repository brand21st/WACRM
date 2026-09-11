import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { CHAT_FILTERS, type ChatFilter, isManualConversation } from '@/features/conversations/conversation-filters';
import { useConversations } from '@/features/conversations/use-conversations';
import { useAiConfig } from '@/features/ai/use-ai-config';
import { isFullAgentOn } from '@/types/ai';
import { useTheme } from '@/hooks/use-theme';

type ChatFilterBarProps = {
  value: ChatFilter;
  onChange: (filter: ChatFilter) => void;
};

export function ChatFilterBar({ value, onChange }: ChatFilterBarProps) {
  const theme = useTheme();
  const conversations = useConversations();
  const aiConfig = useAiConfig();
  const fullAgentOn = isFullAgentOn(aiConfig.data);
  
  const unreadCount = conversations.data?.filter(c => c.unread_count > 0).length || 0;
  const manualCount = conversations.data?.filter(c => isManualConversation(c, fullAgentOn)).length || 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.bar, { backgroundColor: theme.surfaceLowest }]}>
      {CHAT_FILTERS.map((filter) => {
        const selected = filter.id === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={filter.id}
            onPress={() => onChange(filter.id)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: selected ? theme.filterBg : theme.backgroundElement,
              },
              pressed && { opacity: 0.8 },
            ]}>
            
            {filter.id === 'ai' && (
              <SymbolView name={{ android: 'auto_awesome', ios: 'sparkles', web: 'auto_awesome' }} size={13} tintColor={selected ? theme.accentInk : theme.textMuted} style={styles.icon} />
            )}
            {filter.id === 'initiatives' && (
              <SymbolView name={{ android: 'label', ios: 'tag', web: 'label' }} size={14} tintColor={selected ? theme.accentInk : theme.textMuted} style={styles.icon} />
            )}
            
            <ThemedText
              style={[{ color: selected ? theme.accentInk : theme.textMuted, fontSize: 13, fontWeight: '500' }]}>
              {filter.label}
            </ThemedText>

            {filter.id === 'unread' && unreadCount > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.accent }]}>
                <ThemedText style={styles.badgeText}>{unreadCount}</ThemedText>
              </View>
            )}
            {filter.id === 'manual' && manualCount > 0 && (
              <View style={[styles.badge, { backgroundColor: theme.manualFill }]}>
                <ThemedText style={[styles.badgeText, { color: theme.manual }]}>{manualCount}</ThemedText>
              </View>
            )}

          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexGrow: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F2F5',
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  chip: {
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 4,
  },
  icon: {
    marginRight: 2,
  },
  badge: {
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    marginLeft: 4,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
