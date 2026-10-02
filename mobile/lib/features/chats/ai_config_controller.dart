import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../api/ai_api.dart';
import '../../app/providers.dart';
import '../../data/ai_config_rls.dart';
import '../../models/ai.dart';
import '../auth/auth_controller.dart';

class AiConfigController extends StateNotifier<AsyncValue<AiConfig>> {
  AiConfigController(this._ref) : super(const AsyncValue.loading()) {
    reload();
  }

  final Ref _ref;

  Future<void> reload() async {
    if (!_ref.read(authProvider).isSignedIn) {
      state = const AsyncValue.data(AiConfig(configured: false));
      return;
    }
    try {
      final client = _ref.read(crmClientProvider);
      final supabase = _ref.read(supabaseProvider);
      final config = await fetchAiConfig(
        client,
        rlsFallback: () => loadAiConfigViaRls(supabase),
      );
      state = AsyncValue.data(config);
    } catch (error, stack) {
      state = AsyncValue.error(error, stack);
    }
  }

  Future<void> setFullAgent(bool enabled) async {
    final client = _ref.read(crmClientProvider);
    final supabase = _ref.read(supabaseProvider);
    final updated = await updateAiConfig(
      client,
      body: {'full_agent_enabled': enabled, if (enabled) 'auto_reply_enabled': true, if (enabled) 'is_active': true},
      rlsWrite: (body) => updateAiConfigViaRls(supabase, body),
    );
    state = AsyncValue.data(updated);
  }
}

final aiConfigProvider = StateNotifierProvider<AiConfigController, AsyncValue<AiConfig>>((ref) {
  return AiConfigController(ref);
});
