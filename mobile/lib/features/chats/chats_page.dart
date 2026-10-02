import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../models/account.dart';
import '../auth/auth_controller.dart';
import 'ai_config_controller.dart';
import 'conversation_filters.dart';
import 'conversations_controller.dart';

class ChatsPage extends ConsumerStatefulWidget {
  const ChatsPage({super.key});

  @override
  ConsumerState<ChatsPage> createState() => _ChatsPageState();
}

class _ChatsPageState extends ConsumerState<ChatsPage> {
  ChatFilter _filter = ChatFilter.all;
  String _query = '';
  String? _tag;
  bool _searchOpen = false;
  bool? _pendingAi;

  static const _initiatives = ['Purchase', 'Product Inquiry', 'Follow-up', 'Closing'];

  @override
  Widget build(BuildContext context) {
    final conversations = ref.watch(conversationsProvider);
    final account = ref.watch(authProvider).account;
    final ai = ref.watch(aiConfigProvider).asData?.value;
    final fullAgentOn = _pendingAi ?? ai?.isFullAgentOn ?? false;
    final canEditAi = account != null && canEditAccountAiSettings(account.role) && ai?.configured == true;
    final rows = filterConversations(
      conversations.asData?.value ?? const [],
      filter: _filter,
      query: _query,
      tag: _tag,
    );
    final unread = (conversations.asData?.value ?? const [])
        .fold<int>(0, (sum, item) => sum + item.unreadCount);

    return Scaffold(
      appBar: AppBar(
        title: _searchOpen
            ? TextField(
                autofocus: true,
                decoration: const InputDecoration(
                  hintText: 'Search chats',
                  border: InputBorder.none,
                  filled: false,
                ),
                onChanged: (value) => setState(() => _query = value),
              )
            : Text(account?.accountName ?? 'Chats'),
        actions: [
          IconButton(
            onPressed: () => setState(() {
              _searchOpen = !_searchOpen;
              if (!_searchOpen) _query = '';
            }),
            icon: Icon(_searchOpen ? Icons.close : Icons.search),
          ),
          if (canEditAi)
            Switch(
              value: fullAgentOn,
              onChanged: (value) async {
                setState(() => _pendingAi = value);
                try {
                  await ref.read(aiConfigProvider.notifier).setFullAgent(value);
                } finally {
                  if (mounted) setState(() => _pendingAi = null);
                }
              },
            ),
        ],
      ),
      body: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: Row(
              children: [
                for (final item in chatFilters)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      label: Text(
                        item.id == ChatFilter.unread && unread > 0
                            ? '${item.label} $unread'
                            : item.label,
                      ),
                      selected: _filter == item.id,
                      onSelected: (_) => setState(() => _filter = item.id),
                    ),
                  ),
              ],
            ),
          ),
          if (_filter == ChatFilter.initiatives)
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: [
                  for (final tag in _initiatives)
                    Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: FilterChip(
                        label: Text(tag),
                        selected: _tag == tag,
                        onSelected: (selected) => setState(() => _tag = selected ? tag : null),
                      ),
                    ),
                ],
              ),
            ),
          Expanded(
            child: conversations.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(error.toString()),
                    TextButton(
                      onPressed: () => ref.read(conversationsProvider.notifier).reload(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (_) {
                if (rows.isEmpty) {
                  return const Center(child: Text('No conversations'));
                }
                return RefreshIndicator(
                  onRefresh: () => ref.read(conversationsProvider.notifier).reload(),
                  child: ListView.separated(
                    itemCount: rows.length,
                    separatorBuilder: (_, _) => const Divider(height: 1),
                    itemBuilder: (context, index) {
                      final item = rows[index];
                      final time = item.lastMessageAt == null
                          ? ''
                          : DateFormat.jm().format(DateTime.parse(item.lastMessageAt!).toLocal());
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundImage: item.contact?.avatarUrl != null
                              ? NetworkImage(item.contact!.avatarUrl!)
                              : null,
                          child: item.contact?.avatarUrl == null
                              ? Text(item.displayName.isNotEmpty ? item.displayName[0].toUpperCase() : '?')
                              : null,
                        ),
                        title: Text(item.displayName, maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text(
                          item.lastMessageText ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(time, style: Theme.of(context).textTheme.labelSmall),
                            if (item.unreadCount > 0)
                              Container(
                                margin: const EdgeInsets.only(top: 4),
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Theme.of(context).colorScheme.primary,
                                  borderRadius: BorderRadius.circular(10),
                                ),
                                child: Text(
                                  '${item.unreadCount}',
                                  style: const TextStyle(color: Colors.white, fontSize: 11),
                                ),
                              ),
                          ],
                        ),
                        onTap: () => context.push('/chat/${item.id}'),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
