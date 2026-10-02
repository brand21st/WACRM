import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_controller.dart';
import '../push/push_service.dart';
import '../../app/providers.dart';

class SettingsPage extends ConsumerWidget {
  const SettingsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            title: Text(auth.account?.accountName ?? 'Account'),
            subtitle: Text(auth.account?.role.name ?? ''),
          ),
          ListTile(
            title: const Text('Notifications'),
            subtitle: const Text('Allow alerts for inbound WhatsApp messages'),
            onTap: () async {
              final push = PushService(ref.read(crmClientProvider));
              await push.init(onOpen: (_) {});
              await push.register();
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Notification permission updated')),
                );
              }
            },
          ),
          ListTile(
            title: const Text('Sign out'),
            onTap: () => ref.read(authProvider.notifier).signOut(),
          ),
        ],
      ),
    );
  }
}
