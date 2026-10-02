import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/providers.dart';
import 'app/router.dart';
import 'app/theme.dart';
import 'config/env.dart';
import 'data/supabase_init.dart';
import 'features/auth/auth_controller.dart';
import 'features/conversation/inbox_realtime_host.dart';
import 'features/push/push_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final env = Env.read();
  if (Env.isConfigured(env)) {
    await initSupabase(env);
  }
  runApp(const ProviderScope(child: VachatApp()));
}

class VachatApp extends ConsumerStatefulWidget {
  const VachatApp({super.key});

  @override
  ConsumerState<VachatApp> createState() => _VachatAppState();
}

class _VachatAppState extends ConsumerState<VachatApp> {
  PushService? _push;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _boot());
  }

  Future<void> _boot() async {
    if (!Env.isConfigured(ref.read(envProvider))) return;
    final appLinks = AppLinks();
    appLinks.uriLinkStream.listen((uri) {
      ref.read(authProvider.notifier).handleAuthCallback(uri);
      final conversationId = uri.queryParameters['conversationId'];
      if (conversationId != null) {
        ref.read(pendingConversationIdProvider.notifier).state = conversationId;
      }
    });
    try {
      final initial = await appLinks.getInitialLink();
      if (initial != null) {
        await ref.read(authProvider.notifier).handleAuthCallback(initial);
      }
    } catch (_) {}

    _push = PushService(ref.read(crmClientProvider));
    await _push!.init(
      onOpen: (conversationId) {
        ref.read(pendingConversationIdProvider.notifier).state = conversationId;
        ref.read(routerProvider).go('/chat/$conversationId');
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    ref.listen(authProvider, (previous, next) {
      if (previous?.isSignedIn == true && !next.isSignedIn) {
        _push?.unregister();
      }
      if (previous?.isSignedIn != true && next.isSignedIn) {
        _push?.register();
      }
    });
    return InboxRealtimeHost(
      child: MaterialApp.router(
        title: 'VaChat',
        theme: buildAppTheme(),
        routerConfig: router,
      ),
    );
  }
}
