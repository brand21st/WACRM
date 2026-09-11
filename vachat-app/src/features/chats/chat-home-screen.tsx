import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { useAccount } from '@/features/account/use-account';
import { useAiConfig, useUpdateAiConfig } from '@/features/ai/use-ai-config';
import { ChatEmptyState } from '@/features/chats/chat-empty-state';
import { ChatErrorState } from '@/features/chats/chat-error-state';
import { ChatFilterBar } from '@/features/chats/chat-filter-bar';
import { ChatHomeHeader } from '@/features/chats/chat-home-header';
import { InitiativeChipRow } from '@/features/chats/initiative-chip-row';
import { ConversationRow } from '@/features/chats/conversation-row';
import { ConversationListSkeleton } from '@/features/chats/conversation-row-skeleton';
import {
  filterConversations,
  type ChatFilter,
} from '@/features/conversations/conversation-filters';
import { useConversations } from '@/features/conversations/use-conversations';
import { RealtimeBanner } from '@/features/realtime/realtime-banner';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';
import { canEditAccountAiSettings, isFullAgentOn } from '@/types/ai';
import { isApiError } from '@/lib/api-error';
import type { MobileConversation } from '@/types/conversations';

export function ChatHomeScreen() {
  const theme = useTheme();
  const account = useAccount();
  const conversations = useConversations();
  const aiConfig = useAiConfig();
  const updateAi = useUpdateAiConfig();
  const [filter, setFilter] = useState<ChatFilter>('all');
  const [tag, setTag] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAi, setPendingAi] = useState<boolean | null>(null);

  const fullAgentOn = isFullAgentOn(aiConfig.data);
  const displayFullAgentOn = pendingAi ?? fullAgentOn;
  const role = account.data?.role;
  const canEditAi = canEditAccountAiSettings(role, aiConfig.data);

  const rows = useMemo(
    () => filterConversations(conversations.data ?? [], filter, displayFullAgentOn, searchQuery, tag),
    [conversations.data, filter, displayFullAgentOn, searchQuery, tag],
  );

  const onToggleAi = useCallback(
    (next: boolean) => {
      if (updateAi.isPending) return;
      if (!canEditAi) {
        Alert.alert(
          'AI Auto',
          role === 'agent' || role === 'viewer'
            ? 'Only account owners and admins can change AI Auto.'
            : 'Set up AI in Settings before turning on AI Auto.',
        );
        return;
      }
      setPendingAi(next);
      updateAi.mutate(
        {
          provider: aiConfig.data?.provider,
          model: aiConfig.data?.model,
          full_agent_enabled: next,
          ...(next ? { auto_reply_enabled: true, is_active: true } : {}),
        },
        {
          onSettled: () => setPendingAi(null),
          onError: (error) => {
            const message = isApiError(error)
              ? error.message
              : error instanceof Error
                ? error.message
                : 'Could not update AI settings.';
            Alert.alert('AI Auto', message);
          },
        },
      );
    },
    [aiConfig.data?.model, aiConfig.data?.provider, canEditAi, role, updateAi],
  );

  const onOpenChat = useCallback((id: string) => {
    router.push({ pathname: '/chat/[id]', params: { id } });
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: MobileConversation }) => (
      <ConversationRow conversation={item} fullAgentOn={displayFullAgentOn} onPress={onOpenChat} />
    ),
    [displayFullAgentOn, onOpenChat],
  );

  const listEmpty = conversations.isLoading ? (
    <ConversationListSkeleton />
  ) : conversations.error ? (
    <ChatErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />
  ) : (
    <ChatEmptyState filter={filter} hasSearch={Boolean(searchQuery.trim()) || Boolean(tag)} />
  );

  const footer = (
    <View style={styles.footer}>
      <SymbolView name={{ android: 'lock', ios: 'lock.fill', web: 'lock' }} size={14} tintColor={theme.textSecondary} style={styles.footerIcon} />
      <ThemedText style={[styles.footerText, { color: theme.textSecondary }]}>Your personal messages are end-to-end encrypted</ThemedText>
    </View>
  );

  return (
    <View style={[styles.screen, { backgroundColor: theme.surfaceLowest }]}>
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ChatHomeHeader
          aiPending={updateAi.isPending}
          canEditAi={canEditAi}
          fullAgentOn={displayFullAgentOn}
          onChangeSearch={setSearchQuery}
          onToggleAi={onToggleAi}
          onToggleSearch={() => {
            setSearchOpen((open) => {
              if (open) setSearchQuery('');
              return !open;
            });
          }}
          searchOpen={searchOpen}
          searchQuery={searchQuery}
        />
        <RealtimeBanner />
        <ChatFilterBar onChange={setFilter} value={filter} />
        <InitiativeChipRow selectedTag={tag} onSelectTag={setTag} />
        <FlatList
          contentContainerStyle={[
            rows.length === 0 ? styles.emptyList : undefined,
            styles.listContent,
          ]}
          data={conversations.isLoading || conversations.error ? [] : rows}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={listEmpty}
          ListFooterComponent={rows.length > 0 ? footer : null}
          refreshControl={
            <RefreshControl
              onRefresh={() => {
                void conversations.refetch();
                void aiConfig.refetch();
              }}
              refreshing={conversations.isRefetching && !conversations.isLoading}
              tintColor={theme.accent}
            />
          }
          renderItem={renderItem}
          style={styles.list}
        />
        <Pressable style={[styles.fab, { backgroundColor: theme.accent }]} onPress={() => router.push('/(tabs)/contacts')}>
          <SymbolView name={{ android: 'edit_square', ios: 'square.and.pencil', web: 'edit_square' }} size={24} tintColor="#FFFFFF" />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safe: {
    flex: 1,
  },
  list: {
    flex: 1,
  },
  emptyList: {
    flexGrow: 1,
  },
  listContent: {
    paddingBottom: 88,
  },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 80, // Above the custom tab bar
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#00A884',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.four,
    gap: 6,
  },
  footerIcon: {
    marginRight: 2,
  },
  footerText: {
    fontSize: 10.5,
    fontWeight: '400',
    letterSpacing: 0.2,
  },
});
