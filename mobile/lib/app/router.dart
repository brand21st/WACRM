import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_controller.dart';
import '../features/auth/env_missing_page.dart';
import '../features/auth/login_page.dart';
import '../features/chats/chats_page.dart';
import '../features/conversation/conversation_page.dart';
import '../features/settings/settings_page.dart';
import '../features/shell/shell_page.dart';

final pendingConversationIdProvider = StateProvider<String?>((ref) => null);

class _RouterRefresh extends ChangeNotifier {
  void ping() => notifyListeners();
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _RouterRefresh();
  ref.onDispose(refresh.dispose);
  ref.listen(authProvider, (previous, next) => refresh.ping());

  return GoRouter(
    initialLocation: '/chats',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final loc = state.matchedLocation;
      if (!auth.envOk) {
        return loc == '/env-missing' ? null : '/env-missing';
      }
      if (auth.isLoading) return null;
      final loggingIn = loc == '/login';
      if (!auth.isSignedIn) {
        return loggingIn ? null : '/login';
      }
      if (loggingIn || loc == '/env-missing') {
        final pending = ref.read(pendingConversationIdProvider);
        if (pending != null) return '/chat/$pending';
        return '/chats';
      }
      return null;
    },
    routes: [
      GoRoute(path: '/login', builder: (context, state) => const LoginPage()),
      GoRoute(path: '/env-missing', builder: (context, state) => const EnvMissingPage()),
      GoRoute(
        path: '/chat/:id',
        builder: (context, state) => ConversationPage(conversationId: state.pathParameters['id']!),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) => ShellPage(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) => const PlaceholderPage(
                  title: 'Home',
                  body: 'Dashboard comes in a later phase.',
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/chats', builder: (context, state) => const ChatsPage()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/calls',
                builder: (context, state) => const PlaceholderPage(
                  title: 'Calls',
                  body: 'WhatsApp calling comes in a later phase.',
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/contacts',
                builder: (context, state) => const PlaceholderPage(
                  title: 'Contacts',
                  body: 'The contacts directory comes in a later phase.',
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/settings', builder: (context, state) => const SettingsPage()),
            ],
          ),
        ],
      ),
    ],
  );
});
