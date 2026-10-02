import 'dart:io';
import 'dart:typed_data';

import 'package:mime/mime.dart';
import 'package:path/path.dart' as p;
import 'package:supabase_flutter/supabase_flutter.dart';

import 'account_rls.dart';

const chatMediaBucket = 'chat-media';

const mediaMaxBytes = {
  'image': 5 * 1024 * 1024,
  'video': 16 * 1024 * 1024,
  'audio': 16 * 1024 * 1024,
  'document': 16 * 1024 * 1024,
};

String buildMediaPath(String accountId, String fileName) {
  final ext = p.extension(fileName).replaceFirst('.', '').toLowerCase();
  final base = p
      .basenameWithoutExtension(fileName)
      .replaceAll(RegExp(r'[^a-zA-Z0-9_-]+'), '_');
  final safeBase = (base.isEmpty ? 'file' : base).substring(
    0,
    (base.isEmpty ? 4 : base.length).clamp(1, 40),
  );
  final now = DateTime.now().millisecondsSinceEpoch;
  return 'account-$accountId/$now-$safeBase.${ext.isEmpty ? 'bin' : ext}';
}

Future<({String publicUrl, String path})> uploadChatMedia(
  SupabaseClient supabase, {
  required String filePath,
  required String fileName,
  required String kind,
  String? mimeType,
}) async {
  final max = mediaMaxBytes[kind] ?? mediaMaxBytes['document']!;
  final bytes = await File(filePath).readAsBytes();
  if (bytes.length > max) {
    throw Exception('File is too large (max ${(max / (1024 * 1024)).round()} MB).');
  }
  final accountId = await currentAccountId(supabase);
  if (accountId == null) throw Exception('Could not resolve your account.');
  final path = buildMediaPath(accountId, fileName);
  final contentType = mimeType ?? lookupMimeType(fileName) ?? 'application/octet-stream';
  await supabase.storage.from(chatMediaBucket).uploadBinary(
        path,
        Uint8List.fromList(bytes),
        fileOptions: FileOptions(contentType: contentType, upsert: false),
      );
  final publicUrl = supabase.storage.from(chatMediaBucket).getPublicUrl(path);
  return (publicUrl: publicUrl, path: path);
}
