import '../models/conversation.dart';
import 'api_error.dart';
import 'crm_client.dart';

Future<List<MobileConversation>> fetchConversations(
  CrmClient client, {
  Future<List<MobileConversation>> Function()? rlsFallback,
}) async {
  try {
    final data = await client.get<Map<String, dynamic>>(
      '/api/conversations?limit=100',
      quiet: true,
    );
    final rows = data['conversations'] as List? ?? const [];
    return rows
        .whereType<Map<String, dynamic>>()
        .map(MobileConversation.fromJson)
        .toList();
  } catch (error) {
    if (rlsFallback != null) {
      try {
        return await rlsFallback();
      } catch (_) {}
    }
    if (error is ApiError) rethrow;
    throw ApiError(0, error.toString(), code: 'offline');
  }
}

Future<MobileConversation> fetchConversation(
  CrmClient client,
  String id, {
  Future<MobileConversation> Function()? rlsFallback,
}) async {
  try {
    final data = await client.get<Map<String, dynamic>>(
      '/api/conversations/$id',
      quiet: true,
    );
    return MobileConversation.fromJson(
      data['conversation'] as Map<String, dynamic>,
    );
  } catch (error) {
    if (rlsFallback != null) {
      try {
        return await rlsFallback();
      } catch (_) {}
    }
    if (error is ApiError) rethrow;
    throw ApiError(0, error.toString(), code: 'offline');
  }
}
