import 'crm_client.dart';

Future<void> registerPushToken(
  CrmClient client, {
  required String token,
  required String platform,
  String provider = 'fcm',
}) {
  return client.send<Map<String, dynamic>>(
    '/api/device-push-tokens',
    method: 'POST',
    body: {
      'token': token,
      'provider': provider,
      'platform': platform,
    },
  );
}

Future<void> unregisterPushToken(
  CrmClient client, {
  required String token,
  String provider = 'fcm',
}) {
  return client.send<Map<String, dynamic>>(
    '/api/device-push-tokens',
    method: 'DELETE',
    body: {
      'token': token,
      'provider': provider,
    },
  );
}
