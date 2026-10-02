import 'dart:io';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:record/record.dart';

import '../../api/ai_api.dart';
import '../../api/catalog_api.dart';
import '../../api/whatsapp_api.dart';
import '../../app/providers.dart';
import '../../data/chat_media.dart';
import '../../data/conversations_rls.dart';
import '../../data/messages_rls.dart';
import '../../data/session_window.dart';
import '../../models/account.dart';
import '../../models/catalog.dart';
import '../../models/conversation.dart';
import '../../models/message.dart';
import '../auth/auth_controller.dart';
import '../chats/conversations_controller.dart';
import 'messages_controller.dart';

class ConversationPage extends ConsumerStatefulWidget {
  const ConversationPage({super.key, required this.conversationId});

  final String conversationId;

  @override
  ConsumerState<ConversationPage> createState() => _ConversationPageState();
}

class _ConversationPageState extends ConsumerState<ConversationPage> {
  final _text = TextEditingController();
  final _recorder = AudioRecorder();
  ChatMessage? _replyTo;
  bool _sending = false;
  bool _recording = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _markRead());
  }

  @override
  void dispose() {
    _text.dispose();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _markRead() async {
    final conversation = ref.read(conversationProvider(widget.conversationId)).asData?.value;
    if (conversation == null || conversation.unreadCount <= 0) return;
    await markConversationRead(ref.read(supabaseProvider), conversation.id);
    ref.read(conversationsProvider.notifier).patch(conversation.copyWith(unreadCount: 0));
  }

  Future<void> _send({
    required String type,
    String? text,
    String? mediaUrl,
    String? filename,
    String? templateName,
    String? templateLanguage,
  }) async {
    final conversation = ref.read(conversationProvider(widget.conversationId)).asData?.value;
    final role = ref.read(authProvider).account?.role;
    if (conversation == null || role == null || !canSendMessages(role)) return;
    if (type == 'text' && (text == null || text.trim().isEmpty) && mediaUrl == null) return;
    setState(() => _sending = true);
    final localId = 'local-${DateTime.now().millisecondsSinceEpoch}';
    final optimistic = ChatMessage(
      id: localId,
      conversationId: widget.conversationId,
      senderType: SenderType.agent,
      contentType: parseContentType(type == 'template' ? 'template' : type),
      contentText: text,
      mediaUrl: mediaUrl,
      filename: filename,
      status: MessageStatus.sending,
      createdAt: DateTime.now().toUtc().toIso8601String(),
      replyToMessageId: _replyTo?.id,
    );
    ref.read(messagesProvider(widget.conversationId).notifier).upsert(optimistic);
    try {
      final response = await sendWhatsAppMessage(
        ref.read(crmClientProvider),
        SendMessageBody(
          conversationId: widget.conversationId,
          messageType: type,
          contentText: text,
          mediaUrl: mediaUrl,
          filename: filename,
          templateName: templateName,
          templateLanguage: templateLanguage,
          replyToMessageId: _replyTo?.id,
        ),
        channel: conversation.resolvedChannel,
      );
      ref.read(messagesProvider(widget.conversationId).notifier).replaceId(
            localId,
            optimistic.copyWith(
              id: response.messageId ?? localId,
              status: MessageStatus.sent,
              messageId: response.whatsappMessageId,
            ),
          );
      _text.clear();
      setState(() => _replyTo = null);
    } catch (error) {
      ref.read(messagesProvider(widget.conversationId).notifier).replaceId(
            localId,
            optimistic.copyWith(status: MessageStatus.failed),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _pickAndSend(String kind) async {
    String? path;
    String name;
    if (kind == 'image') {
      final file = await ImagePicker().pickImage(source: ImageSource.gallery, imageQuality: 85);
      if (file == null) return;
      path = file.path;
      name = file.name;
    } else {
      final files = await FilePicker.pickFiles();
      if (files.isEmpty || files.first.path == null) return;
      path = files.first.path;
      name = files.first.name;
    }
    if (path == null) return;
    try {
      final uploaded = await uploadChatMedia(
        ref.read(supabaseProvider),
        filePath: path,
        fileName: name,
        kind: kind,
      );
      await _send(type: kind, mediaUrl: uploaded.publicUrl, filename: name, text: _text.text.trim().isEmpty ? null : _text.text.trim());
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _toggleRecord() async {
    if (_recording) {
      final path = await _recorder.stop();
      setState(() => _recording = false);
      if (path == null) return;
      final uploaded = await uploadChatMedia(
        ref.read(supabaseProvider),
        filePath: path,
        fileName: 'voice.m4a',
        kind: 'audio',
        mimeType: 'audio/mp4',
      );
      await _send(type: 'audio', mediaUrl: uploaded.publicUrl, filename: 'voice.m4a');
      return;
    }
    if (!await _recorder.hasPermission()) return;
    final dir = await Directory.systemTemp.createTemp('vachat-voice');
    final path = '${dir.path}/voice.m4a';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    setState(() => _recording = true);
  }

  Future<void> _toggleAi(MobileConversation conversation, bool nextOn) async {
    final result = await setConversationAutoreply(
      ref.read(crmClientProvider),
      conversationId: conversation.id,
      paused: !nextOn,
      assignToMe: !nextOn,
      rlsWrite: () => setConversationAutoreplyViaRls(
        ref.read(supabaseProvider),
        conversationId: conversation.id,
        paused: !nextOn,
        assignToMe: !nextOn,
      ),
    );
    ref.read(conversationsProvider.notifier).patch(result.conversation);
  }

  @override
  Widget build(BuildContext context) {
    final conversationAsync = ref.watch(conversationProvider(widget.conversationId));
    final messages = ref.watch(messagesProvider(widget.conversationId));
    final reactions = ref.watch(reactionsProvider(widget.conversationId)).asData?.value ?? const [];
    final role = ref.watch(authProvider).account?.role;
    final canSend = role != null && canSendMessages(role);
    final expired = conversationAsync.asData?.value == null
        ? false
        : isWindowExpired(conversationAsync.asData!.value.customerServiceExpiresAt);

    return Scaffold(
      appBar: AppBar(
        title: conversationAsync.when(
          data: (conversation) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(conversation.displayName, style: const TextStyle(fontSize: 16)),
              Text(
                formatWindowRemaining(conversation.customerServiceExpiresAt),
                style: Theme.of(context).textTheme.labelSmall,
              ),
            ],
          ),
          loading: () => const Text('Chat'),
          error: (error, _) => const Text('Chat'),
        ),
        actions: [
          conversationAsync.maybeWhen(
            data: (conversation) {
              final aiOn = !conversation.aiAutoreplyDisabled;
              return IconButton(
                tooltip: aiOn ? 'Pause AI' : 'Resume AI',
                onPressed: canSend ? () => _toggleAi(conversation, !aiOn) : null,
                icon: Icon(aiOn ? Icons.smart_toy : Icons.smart_toy_outlined),
              );
            },
            orElse: () => const SizedBox.shrink(),
          ),
          IconButton(
            onPressed: () {
              final conversation = conversationAsync.asData?.value;
              if (conversation == null) return;
              showModalBottomSheet<void>(
                context: context,
                builder: (_) => _CustomerInfo(conversation: conversation),
              );
            },
            icon: const Icon(Icons.info_outline),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: messages.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => Center(child: Text(error.toString())),
              data: (items) {
                return ListView.builder(
                  padding: const EdgeInsets.all(12),
                  itemCount: items.length,
                  itemBuilder: (context, index) {
                    final message = items[index];
                    final mine = message.isOutbound;
                    final emoji = reactions
                        .where((item) => item.messageId == message.id)
                        .map((item) => item.emoji)
                        .join(' ');
                    return Align(
                      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
                      child: GestureDetector(
                        onLongPress: canSend
                            ? () async {
                                await reactToWhatsAppMessage(
                                  ref.read(crmClientProvider),
                                  message.id,
                                  '👍',
                                );
                                ref.invalidate(reactionsProvider(widget.conversationId));
                              }
                            : null,
                        child: Container(
                          margin: const EdgeInsets.symmetric(vertical: 4),
                          padding: const EdgeInsets.all(10),
                          constraints: const BoxConstraints(maxWidth: 320),
                          decoration: BoxDecoration(
                            color: mine ? const Color(0xFFCCFBF1) : Colors.white,
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              if (message.mediaUrl != null &&
                                  (message.contentType == ContentType.image))
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: CachedNetworkImage(imageUrl: message.mediaUrl!, height: 160),
                                ),
                              Text(
                                message.contentText?.trim().isNotEmpty == true
                                    ? message.contentText!
                                    : message.contentType.name,
                              ),
                              const SizedBox(height: 4),
                              Text(
                                message.status.name,
                                style: Theme.of(context).textTheme.labelSmall,
                              ),
                              if (emoji.isNotEmpty) Text(emoji),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
          if (_replyTo != null)
            ListTile(
              dense: true,
              title: const Text('Replying'),
              subtitle: Text(_replyTo!.contentText ?? _replyTo!.contentType.name, maxLines: 1),
              trailing: IconButton(
                onPressed: () => setState(() => _replyTo = null),
                icon: const Icon(Icons.close),
              ),
            ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: Row(
                children: [
                  IconButton(
                    onPressed: !canSend || _sending ? null : () => _showAttach(expired),
                    icon: const Icon(Icons.add),
                  ),
                  Expanded(
                    child: TextField(
                      controller: _text,
                      enabled: canSend && !expired,
                      minLines: 1,
                      maxLines: 4,
                      decoration: InputDecoration(
                        hintText: expired
                            ? '24h window expired — send a template'
                            : canSend
                                ? 'Message'
                                : 'View only',
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: !canSend || _sending ? null : _toggleRecord,
                    icon: Icon(_recording ? Icons.stop_circle : Icons.mic_none),
                  ),
                  IconButton(
                    onPressed: !canSend || _sending || expired
                        ? null
                        : () => _send(type: 'text', text: _text.text.trim()),
                    icon: const Icon(Icons.send),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showAttach(bool expired) async {
    final conversation = ref.read(conversationProvider(widget.conversationId)).asData?.value;
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (!expired) ...[
                ListTile(
                  leading: const Icon(Icons.image_outlined),
                  title: const Text('Photo'),
                  onTap: () {
                    Navigator.pop(context);
                    _pickAndSend('image');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.attach_file),
                  title: const Text('Document'),
                  onTap: () {
                    Navigator.pop(context);
                    _pickAndSend('document');
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.storefront_outlined),
                  title: const Text('Catalog'),
                  onTap: () {
                    Navigator.pop(context);
                    _openCatalog();
                  },
                ),
              ],
              ListTile(
                leading: const Icon(Icons.article_outlined),
                title: const Text('Template'),
                onTap: () {
                  Navigator.pop(context);
                  _openTemplates();
                },
              ),
              if (conversation != null)
                ListTile(
                  leading: const Icon(Icons.person_outline),
                  title: const Text('Customer'),
                  onTap: () {
                    Navigator.pop(context);
                    showModalBottomSheet<void>(
                      context: this.context,
                      builder: (_) => _CustomerInfo(conversation: conversation),
                    );
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _openTemplates() async {
    final templates = await ref.read(templatesProvider.future);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      builder: (context) {
        return ListView(
          children: [
            const ListTile(title: Text('Approved templates')),
            for (final template in templates)
              ListTile(
                title: Text(template.name),
                subtitle: Text(template.bodyText, maxLines: 2),
                onTap: () {
                  Navigator.pop(context);
                  if (template.hasVariables) {
                    ScaffoldMessenger.of(this.context).showSnackBar(
                      const SnackBar(content: Text('This template needs variables. Send it from the web inbox.')),
                    );
                    return;
                  }
                  _send(
                    type: 'template',
                    templateName: template.name,
                    templateLanguage: template.language ?? 'en',
                    text: template.bodyText,
                  );
                },
              ),
          ],
        );
      },
    );
  }

  Future<void> _openCatalog() async {
    try {
      final products = await fetchActiveCatalog(ref.read(crmClientProvider));
      if (!mounted) return;
      await showModalBottomSheet<void>(
        context: context,
        builder: (context) {
          return ListView(
            children: [
              const ListTile(title: Text('Catalog')),
              for (final product in products)
                ListTile(
                  leading: product.imageUrl == null
                      ? const Icon(Icons.inventory_2_outlined)
                      : CachedNetworkImage(imageUrl: product.imageUrl!, width: 40, height: 40),
                  title: Text(product.title),
                  subtitle: Text(product.priceLabel),
                  onTap: () {
                    Navigator.pop(context);
                    _sendCatalog(product);
                  },
                ),
            ],
          );
        },
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(error.toString())));
      }
    }
  }

  Future<void> _sendCatalog(CatalogProduct product) async {
    final caption = '${product.title}\n${product.priceLabel}';
    if (product.imageUrl != null) {
      await _send(type: 'image', mediaUrl: product.imageUrl, text: caption, filename: '${product.handle}.jpg');
    } else {
      await _send(type: 'text', text: caption);
    }
  }
}

class _CustomerInfo extends StatelessWidget {
  const _CustomerInfo({required this.conversation});

  final MobileConversation conversation;

  @override
  Widget build(BuildContext context) {
    final contact = conversation.contact;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(conversation.displayName, style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 8),
          Text(contact?.phone ?? 'No phone'),
          if (contact?.email != null) Text(contact!.email!),
          if (contact?.company != null) Text(contact!.company!),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            children: [
              for (final tag in contact?.tags ?? const [])
                Chip(label: Text(tag.name), backgroundColor: Color(_parseColor(tag.color))),
            ],
          ),
        ],
      ),
    );
  }
}

int _parseColor(String value) {
  final hex = value.replaceAll('#', '');
  if (hex.length == 6) return int.parse('FF$hex', radix: 16);
  return 0xFF64748B;
}
