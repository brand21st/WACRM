import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/providers.dart';
import '../../config/env.dart';

class EnvMissingPage extends ConsumerWidget {
  const EnvMissingPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final missing = Env.missing(ref.watch(envProvider));
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Configuration missing', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              Text(
                'Copy mobile/.env.example to .env and run with --dart-define-from-file=.env.\nMissing: ${missing.join(', ')}',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
