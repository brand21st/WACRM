import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import '../../api/push_api.dart';
import '../../api/crm_client.dart';

const incomingPushChannel = 'incoming-messages';

@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}

class PushService {
  PushService(this._client);

  final CrmClient _client;
  final _plugin = FlutterLocalNotificationsPlugin();
  String? _token;
  bool _ready = false;

  Future<void> init({required void Function(String conversationId) onOpen}) async {
    if (kIsWeb) return;
    // FCM is Android/iOS only. Windows desktop is for local login/inbox.
    if (!Platform.isAndroid && !Platform.isIOS) return;
    final options = _firebaseOptions();
    if (options == null) return;
    try {
      await Firebase.initializeApp(options: options);
    } catch (_) {
      try {
        await Firebase.initializeApp();
      } catch (_) {
        return;
      }
    }
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
    await _plugin.initialize(
      settings: const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        iOS: DarwinInitializationSettings(),
      ),
      onDidReceiveNotificationResponse: (response) {
        final id = response.payload;
        if (id != null && id.isNotEmpty) onOpen(id);
      },
    );
    const channel = AndroidNotificationChannel(
      incomingPushChannel,
      'Incoming messages',
      importance: Importance.high,
    );
    await _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    final messaging = FirebaseMessaging.instance;
    await messaging.requestPermission(alert: true, badge: true, sound: true);
    FirebaseMessaging.onMessage.listen((message) {
      final notification = message.notification;
      final conversationId = message.data['conversationId'] as String? ?? '';
      if (notification == null) return;
      _plugin.show(
        id: notification.hashCode,
        title: notification.title,
        body: notification.body,
        notificationDetails: const NotificationDetails(
          android: AndroidNotificationDetails(
            incomingPushChannel,
            'Incoming messages',
            importance: Importance.high,
            priority: Priority.high,
          ),
        ),
        payload: conversationId,
      );
    });
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      final conversationId = message.data['conversationId'] as String?;
      if (conversationId != null) onOpen(conversationId);
    });
    _ready = true;
    await register();
  }

  Future<void> register() async {
    if (!_ready) return;
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) return;
    _token = token;
    final platform = Platform.isIOS ? 'ios' : 'android';
    await registerPushToken(_client, token: token, platform: platform);
  }

  Future<void> unregister() async {
    final token = _token;
    if (token == null) return;
    try {
      await unregisterPushToken(_client, token: token);
    } catch (_) {}
    _token = null;
  }

  FirebaseOptions? _firebaseOptions() {
    const projectId = String.fromEnvironment('FCM_PROJECT_ID');
    const senderId = String.fromEnvironment('FCM_MESSAGING_SENDER_ID');
    if (projectId.isEmpty || senderId.isEmpty) return null;
    if (Platform.isIOS) {
      const apiKey = String.fromEnvironment('FCM_IOS_API_KEY');
      const appId = String.fromEnvironment('FCM_IOS_APP_ID');
      if (apiKey.isEmpty || appId.isEmpty) return null;
      return FirebaseOptions(
        apiKey: apiKey,
        appId: appId,
        messagingSenderId: senderId,
        projectId: projectId,
      );
    }
    const apiKey = String.fromEnvironment('FCM_ANDROID_API_KEY');
    const appId = String.fromEnvironment('FCM_ANDROID_APP_ID');
    if (apiKey.isEmpty || appId.isEmpty) return null;
    return FirebaseOptions(
      apiKey: apiKey,
      appId: appId,
      messagingSenderId: senderId,
      projectId: projectId,
    );
  }
}
