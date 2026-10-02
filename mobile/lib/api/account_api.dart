import '../models/account.dart';
import 'api_error.dart';
import 'crm_client.dart';

Future<MobileAuthResponse> fetchAccount(
  CrmClient client, {
  Future<MobileAuthResponse> Function()? rlsFallback,
}) async {
  try {
    final data = await client.get<Map<String, dynamic>>('/api/account', quiet: true);
    return MobileAuthResponse.fromJson(data);
  } catch (error) {
    if (rlsFallback != null) {
      try {
        return await rlsFallback();
      } catch (_) {
        rethrow;
      }
    }
    if (error is ApiError) rethrow;
    throw ApiError(0, error.toString(), code: 'offline');
  }
}
