import '../models/conversation.dart';
import '../models/message.dart';
import 'crm_client.dart';

Future<SendMessageResponse> sendWhatsAppMessage(
  CrmClient client,
  SendMessageBody body, {
  ChannelType channel = ChannelType.whatsapp,
}) async {
  final path = channel == ChannelType.whatsapp ? '/api/whatsapp/send' : '/api/meta/send';
  final data = await client.send<Map<String, dynamic>>(
    path,
    method: 'POST',
    body: body.toJson(),
  );
  return SendMessageResponse.fromJson(data);
}

Future<void> reactToWhatsAppMessage(CrmClient client, String messageId, String emoji) {
  return client.send<Map<String, dynamic>>(
    '/api/whatsapp/react',
    method: 'POST',
    body: {'message_id': messageId, 'emoji': emoji},
  );
}
