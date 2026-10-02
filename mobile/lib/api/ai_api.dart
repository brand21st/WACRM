import '../models/ai.dart';
import '../models/conversation.dart';
import 'api_error.dart';
import 'crm_client.dart';

Future<AiConfig> fetchAiConfig(
  CrmClient client, {
  Future<AiConfig> Function()? rlsFallback,
}) async {
  if (rlsFallback != null) {
    final viaRls = await rlsFallback();
    if (viaRls.configured) return viaRls;
  }
  try {
    final data = await client.get<Map<String, dynamic>>('/api/ai/config', quiet: true);
    return AiConfig.fromJson(data);
  } catch (error) {
    if (rlsFallback != null) return rlsFallback();
    if (error is ApiError) rethrow;
    throw ApiError(0, error.toString(), code: 'offline');
  }
}

Future<AiConfig> updateAiConfig(
  CrmClient client, {
  required Map<String, dynamic> body,
  required Future<AiConfig> Function(Map<String, dynamic> body) rlsWrite,
}) async {
  final updated = await rlsWrite(body);
  try {
    await client.send<Map<String, dynamic>>(
      '/api/ai/config',
      method: 'POST',
      body: body,
    );
  } catch (error) {
    if (!isOfflineApiError(error)) return updated;
  }
  return updated;
}

class AutoreplyResult {
  const AutoreplyResult({
    required this.success,
    required this.paused,
    required this.conversation,
  });

  final bool success;
  final bool paused;
  final MobileConversation conversation;
}

Future<AutoreplyResult> setConversationAutoreply(
  CrmClient client, {
  required String conversationId,
  required bool paused,
  bool assignToMe = false,
  required Future<AutoreplyResult> Function() rlsWrite,
}) async {
  final updated = await rlsWrite();
  try {
    await client.send<Map<String, dynamic>>(
      '/api/ai/autoreply/$conversationId',
      method: 'POST',
      body: {'paused': paused, if (assignToMe) 'assign_to_me': true},
    );
  } catch (error) {
    if (!isOfflineApiError(error)) return updated;
  }
  return updated;
}
