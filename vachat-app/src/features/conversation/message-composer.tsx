import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { AttachmentSheet, type AttachmentChoice } from '@/features/conversation/attachment-sheet';
import { RecordingBar } from '@/features/conversation/recording-bar';
import { useVoiceRecorder } from '@/features/conversation/use-voice-recorder';
import {
  getConversationDraft,
  setConversationDraft,
} from '@/features/conversation/conversation-drafts';
import { MEDIA_CAPTION_MAX, uploadChatMedia, type MediaKind } from '@/lib/chat-media';
import { ReplyPreview } from '@/features/conversation/reply-preview';
import { TemplateSheet } from '@/features/conversation/template-sheet';
import { useTheme } from '@/hooks/use-theme';
import type { ApprovedTemplate, Message, SendMessageType } from '@/types/messages';

type MessageComposerProps = {
  conversationId: string;
  canCompose: boolean;
  windowExpired: boolean;
  isViewer: boolean;
  replyTo: Message | null;
  onClearReply: () => void;
  sending: boolean;
  onOpenCatalog: () => void;
  onSend: (payload: {
    message_type: SendMessageType;
    content_text?: string;
    media_url?: string;
    filename?: string;
    template_name?: string;
    template_language?: string;
    reply_to_message_id?: string;
  }) => void;
};

function kindFromMime(mime: string, fallback: MediaKind): MediaKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return fallback;
}

export function MessageComposer({
  conversationId,
  canCompose,
  windowExpired,
  isViewer,
  replyTo,
  onClearReply,
  sending,
  onOpenCatalog,
  onSend,
}: MessageComposerProps) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const [text, setText] = useState(() => getConversationDraft(conversationId));
  const [attachOpen, setAttachOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const {
    isRecording,
    durationMs,
    meterLevel,
    draft,
    start: startVoice,
    stop: stopVoice,
    pause: pauseVoice,
    cancel: cancelVoice,
  } = useVoiceRecorder();

  useEffect(() => {
    setText(getConversationDraft(conversationId));
    void cancelVoice();
  }, [conversationId, cancelVoice]);

  useEffect(() => {
    setConversationDraft(conversationId, text);
  }, [conversationId, text]);

  const busy = sending || uploading;
  const hasText = text.trim().length > 0;
  const locked = !canCompose || busy;

  async function sendText() {
    const content = text.trim().slice(0, MEDIA_CAPTION_MAX);
    if (!content || locked || windowExpired) return;
    onSend({
      message_type: 'text',
      content_text: content,
      reply_to_message_id: replyTo?.id,
    });
    setText('');
    setConversationDraft(conversationId, '');
    onClearReply();
  }

  async function attachAndSend(uri: string, fileName: string, mimeType: string, kind: MediaKind) {
    setUploading(true);
    try {
      const uploaded = await uploadChatMedia({ uri, fileName, mimeType, kind });
      const caption = kind === 'audio' ? undefined : text.trim().slice(0, MEDIA_CAPTION_MAX) || undefined;
      onSend({
        message_type: kind === 'audio' ? 'audio' : kind,
        content_text: caption,
        media_url: uploaded.publicUrl,
        filename: fileName,
        reply_to_message_id: replyTo?.id,
      });
      setText('');
      setConversationDraft(conversationId, '');
      onClearReply();
    } catch (error) {
      Alert.alert('Upload failed', error instanceof Error ? error.message : 'Could not upload that file.');
    } finally {
      setUploading(false);
    }
  }

  async function onPick(choice: AttachmentChoice) {
    setAttachOpen(false);
    if (choice === 'catalog') {
      onOpenCatalog();
      return;
    }
    if (choice === 'quick-replies') {
      setTemplatesOpen(true);
      return;
    }
    if (locked || windowExpired) return;
    try {
      if (choice === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Camera permission', 'Allow camera access to take a photo.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.8,
        });
        const asset = result.assets?.[0];
        if (result.canceled || !asset?.uri) return;
        await attachAndSend(asset.uri, asset.fileName ?? 'photo.jpg', asset.mimeType ?? 'image/jpeg', 'image');
        return;
      }
      if (choice === 'gallery') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert('Photos permission', 'Allow photo library access to attach media.');
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images', 'videos'],
          quality: 0.8,
        });
        const asset = result.assets?.[0];
        if (result.canceled || !asset?.uri) return;
        const mime = asset.mimeType ?? 'image/jpeg';
        const kind = kindFromMime(mime, 'image');
        await attachAndSend(asset.uri, asset.fileName ?? (kind === 'video' ? 'video.mp4' : 'photo.jpg'), mime, kind);
        return;
      }
      if (choice !== 'document') return;
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      await attachAndSend(
        asset.uri,
        asset.name ?? 'document',
        asset.mimeType ?? 'application/octet-stream',
        kindFromMime(asset.mimeType ?? '', 'document'),
      );
    } catch (error) {
      Alert.alert('Could not attach', error instanceof Error ? error.message : 'Try again.');
    }
  }

  async function onVoicePress() {
    if (locked || windowExpired) return;
    setAttachOpen(false);
    const started = await startVoice();
    if (!started) {
      Alert.alert('Microphone', 'Allow microphone access to send voice notes.');
    }
  }

  async function sendVoice() {
    if (locked || windowExpired) return;
    try {
      const clip = await stopVoice();
      if (!clip) {
        Alert.alert('Voice note', 'Record for at least half a second before sending.');
        return;
      }
      await attachAndSend(clip.uri, clip.fileName, clip.mimeType, 'audio');
    } catch (error) {
      Alert.alert(
        'Voice note failed',
        error instanceof Error ? error.message : 'Could not send that voice note.',
      );
    }
  }

  async function pauseVoiceNote() {
    if (locked || windowExpired) return;
    await pauseVoice();
  }

  function onChangeText(next: string) {
    setText(next);
    if (next.trim().length > 0) setAttachOpen(false);
  }

  function toggleAttach() {
    Keyboard.dismiss();
    setAttachOpen((open) => !open);
  }

  function sendTemplate(template: ApprovedTemplate) {
    if (!canCompose || busy) return;
    onSend({
      message_type: 'template',
      template_name: template.name,
      template_language: template.language,
      content_text: template.body_text,
    });
  }

  if (isViewer) {
    return (
      <View style={[styles.locked, { backgroundColor: theme.surface, borderTopColor: theme.separator }]}>
        <ThemedText themeColor="textSecondary" type="small">
          You can view this conversation.
        </ThemedText>
      </View>
    );
  }

  if (windowExpired) {
    return (
      <View style={[styles.lockedCol, { backgroundColor: theme.surface, borderTopColor: theme.separator }]}>
        <ThemedText type="small" style={{ color: theme.manual }}>
          24h window expired
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => setTemplatesOpen(true)}
          style={({ pressed }) => [
            styles.templateBtn,
            { backgroundColor: theme.accent, opacity: pressed || busy ? 0.75 : 1 },
          ]}>
          <ThemedText type="smallBold" style={{ color: theme.unreadOnAccent }}>
            Send template
          </ThemedText>
        </Pressable>
        <TemplateSheet
          visible={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          onSend={sendTemplate}
        />
      </View>
    );
  }

  const showRecording = isRecording || Boolean(draft);

  return (
    <View style={[styles.wrap, { backgroundColor: theme.chatWallpaper }]}>
      {replyTo && !showRecording ? <ReplyPreview message={replyTo} onCancel={onClearReply} /> : null}
      {showRecording ? (
        <Animated.View
          entering={reducedMotion ? undefined : FadeInDown.duration(220)}
          exiting={reducedMotion ? FadeOut.duration(80) : FadeOut.duration(160)}>
          <RecordingBar
            busy={busy}
            draftUri={draft?.uri ?? null}
            durationMs={durationMs}
            isRecording={isRecording}
            meterLevel={meterLevel}
            onCancel={() => void cancelVoice()}
            onPause={() => void pauseVoiceNote()}
            onSend={() => void sendVoice()}
          />
        </Animated.View>
      ) : (
        <Animated.View exiting={reducedMotion ? FadeOut.duration(80) : FadeOut.duration(140)}>
          <View style={styles.bar}>
            <Pressable
              accessibilityLabel={attachOpen ? 'Close attachments' : 'Add attachment'}
              accessibilityRole="button"
              disabled={locked}
              onPress={toggleAttach}
              style={({ pressed }) => [styles.sideIcon, (pressed || locked) && styles.dim]}>
              <SymbolView
                name={{
                  android: attachOpen ? 'close' : 'add',
                  ios: attachOpen ? 'xmark' : 'plus',
                  web: attachOpen ? 'close' : 'add',
                }}
                size={26}
                tintColor={theme.text}
              />
            </Pressable>
            <View style={[styles.inputBox, { backgroundColor: theme.surfaceLowest }]}>
              <TextInput
                accessibilityLabel="Message"
                editable={!locked}
                multiline
                onChangeText={onChangeText}
                placeholder="Type a message"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text }]}
                value={text}
              />
              <Pressable accessibilityLabel="Stickers" accessibilityRole="button" style={styles.sticker}>
                <SymbolView
                  name={{ android: 'sticky_note_2', ios: 'note.text', web: 'sticky_note_2' }}
                  size={22}
                  tintColor={theme.outline}
                />
              </Pressable>
            </View>
            {hasText ? (
              <Pressable
                accessibilityLabel="Send"
                accessibilityRole="button"
                disabled={locked}
                onPress={() => void sendText()}
                style={({ pressed }) => [styles.sideIcon, (pressed || locked) && styles.dim]}>
                <SymbolView
                  name={{ android: 'send', ios: 'paperplane.fill', web: 'send' }}
                  size={22}
                  tintColor={theme.text}
                />
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityLabel="Camera"
                  accessibilityRole="button"
                  disabled={locked}
                  onPress={() => void onPick('camera')}
                  style={({ pressed }) => [styles.sideIcon, (pressed || locked) && styles.dim]}>
                  <SymbolView
                    name={{ android: 'photo_camera', ios: 'camera', web: 'photo_camera' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
                <Pressable
                  accessibilityLabel="Voice note"
                  accessibilityRole="button"
                  disabled={locked}
                  onPress={() => void onVoicePress()}
                  style={({ pressed }) => [styles.sideIcon, (pressed || locked) && styles.dim]}>
                  <SymbolView
                    name={{ android: 'mic', ios: 'mic.fill', web: 'mic' }}
                    size={22}
                    tintColor={theme.text}
                  />
                </Pressable>
              </>
            )}
          </View>
          {attachOpen ? <AttachmentSheet onPick={(choice) => void onPick(choice)} /> : null}
        </Animated.View>
      )}
      <TemplateSheet visible={templatesOpen} onClose={() => setTemplatesOpen(false)} onSend={sendTemplate} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingBottom: 4,
  },
  bar: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 4,
    minHeight: 52,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dim: {
    opacity: 0.6,
  },
  sideIcon: {
    alignItems: 'center',
    height: 40,
    justifyContent: 'center',
    width: 36,
  },
  inputBox: {
    alignItems: 'center',
    borderRadius: 24,
    flex: 1,
    flexDirection: 'row',
    minHeight: 40,
    paddingLeft: 14,
    paddingRight: 4,
  },
  sticker: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  input: {
    flex: 1,
    fontSize: 16,
    lineHeight: 20,
    maxHeight: 120,
    minHeight: 40,
    paddingVertical: 8,
  },
  locked: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  lockedCol: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  templateBtn: {
    alignItems: 'center',
    borderRadius: 10,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
  },
});
