import { Image } from 'expo-image';
import { memo } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { LongPressGestureHandler, State } from 'react-native-gesture-handler';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { CatalogProductCard } from '@/features/conversation/catalog-product-card';
import { formatMessageTime } from '@/features/conversation/format-message-time';
import { MessageStatusTicks } from '@/features/conversation/message-status-ticks';
import { VoiceNotePlayer } from '@/features/conversation/voice-note-player';
import { messagePreview, replyAuthorLabel } from '@/features/conversation/message-preview';
import { useTheme } from '@/hooks/use-theme';
import {
  parseCatalogProductCard,
  type CatalogProductCardData,
} from '@/lib/parse-catalog-product-card';
import { productCardImageUrl } from '@/lib/product-card-image';
import type { Message, MessageReaction } from '@/types/messages';

export type BubbleAvatar = {
  contactId?: string | null;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
};

type MessageBubbleProps = {
  message: Message;
  replyTo?: Message;
  reactions?: MessageReaction[];
  contactAvatar?: BubbleAvatar;
  agentAvatar?: BubbleAvatar;
  onLongPress: () => void;
  onRetry?: () => void;
};

function openUrl(url?: string) {
  if (!url) return;
  void Linking.openURL(url);
}

function formatFileSize(bytes?: number) {
  if (!bytes) return 'PDF Document';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB • PDF Document`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB • PDF Document`;
}

function isOpenableMedia(message: Message, isProductCard: boolean): boolean {
  return (
    !isProductCard &&
    Boolean(message.media_url) &&
    (message.content_type === 'image' ||
      message.content_type === 'video' ||
      message.content_type === 'document')
  );
}

function isInteractiveAudio(message: Message): boolean {
  return message.content_type === 'audio' && Boolean(message.media_url);
}

function MessageBody({
  message,
  onBg,
  outgoing,
  productCard,
  voiceAvatar,
}: {
  message: Message;
  onBg: string | undefined;
  outgoing: boolean;
  productCard: CatalogProductCardData | null;
  voiceAvatar?: BubbleAvatar;
}) {
  const textColor = onBg;
  const muted = '#667781';

  if (productCard) {
    return (
      <CatalogProductCard imageUrl={productCardImageUrl(message)} product={productCard} />
    );
  }

  switch (message.content_type) {
    case 'image':
      return (
        <View>
          {message.media_url ? (
            <Image
              accessibilityLabel="Photo"
              contentFit="cover"
              source={{ uri: message.media_url }}
              style={styles.media}
            />
          ) : (
            <ThemedText style={{ color: muted }} type="small">
              Photo unavailable
            </ThemedText>
          )}
          {message.content_text ? (
            <ThemedText style={[styles.body, { color: textColor }]}>{message.content_text}</ThemedText>
          ) : null}
        </View>
      );
    case 'video':
      return (
        <View>
          <View style={[styles.media, styles.mediaFallback]}>
            <ThemedText style={{ color: '#FFFFFF' }} type="smallBold">
              Play video
            </ThemedText>
          </View>
          {message.content_text ? (
            <ThemedText style={[styles.body, { color: textColor }]}>{message.content_text}</ThemedText>
          ) : null}
        </View>
      );
    case 'audio':
      return (
        <View style={styles.voiceWrap}>
          {message.media_url ? (
            <VoiceNotePlayer
              uri={message.media_url}
              variant={outgoing ? 'outbound' : 'inbound'}
              timeLabel={formatMessageTime(message.created_at)}
              status={message.status}
              contactId={voiceAvatar?.contactId}
              name={voiceAvatar?.name}
              phone={voiceAvatar?.phone}
              avatarUrl={voiceAvatar?.avatarUrl}
            />
          ) : (
            <View style={[styles.media, styles.mediaFallback, { height: 60, width: 220 }]}>
              <SymbolView name={{ android: 'mic', ios: 'mic.fill', web: 'mic' }} size={24} tintColor="#FFFFFF" />
              <ThemedText style={{ color: '#FFFFFF' }} type="smallBold">
                Voice note unavailable
              </ThemedText>
            </View>
          )}
        </View>
      );
    case 'document':
      return (
        <View style={styles.pdfCard}>
          <View style={styles.pdfIconBox}>
            <SymbolView name={{ android: 'description', ios: 'doc.text.fill', web: 'description' }} size={24} tintColor="#DC2626" />
          </View>
          <View style={styles.pdfInfo}>
            <ThemedText numberOfLines={1} style={[styles.pdfName, { color: textColor }]}>
              {message.filename || 'Document.pdf'}
            </ThemedText>
            <ThemedText style={{ color: muted, fontSize: 11 }}>
              {formatFileSize(message.file_size)}
            </ThemedText>
          </View>
          <View style={styles.downloadButton}>
            <SymbolView
              name={{ android: 'download', ios: 'arrow.down', web: 'download' }}
              size={19}
              tintColor={textColor}
            />
          </View>
        </View>
      );
    case 'template':
      return (
        <View>
          <ThemedText style={{ color: muted }} type="smallBold">
            Template
          </ThemedText>
          <ThemedText style={[styles.body, { color: textColor }]}>
            {message.content_text || '[Empty template]'}
          </ThemedText>
        </View>
      );
    default:
      return (
        <ThemedText style={[styles.body, { color: textColor }]}>
          {message.content_text}
        </ThemedText>
      );
  }
}

function MessageBubbleComponent({
  message,
  replyTo,
  reactions,
  contactAvatar,
  agentAvatar,
  onLongPress,
  onRetry,
}: MessageBubbleProps) {
  const theme = useTheme();
  const outgoing = message.sender_type !== 'customer';
  const showAi = message.sender_type === 'bot' || Boolean(message.ai_generated);
  const productCard = parseCatalogProductCard(message.content_text);
  const isVoice = isInteractiveAudio(message);
  const hasInteractiveContent = isVoice || Boolean(productCard);
  const voiceAvatar = outgoing ? agentAvatar : contactAvatar;

  const bg = outgoing ? theme.bubbleOut : theme.bubbleIn;
  const onBg = outgoing ? theme.bubbleOutText : theme.text;
  const metaColor = '#8696A0';
  const bubbleStyle = [
    styles.bubble,
    outgoing && styles.outgoingBubble,
    isVoice && styles.voiceBubble,
    { backgroundColor: bg },
    !outgoing && { borderBottomLeftRadius: 4 },
    outgoing && { borderBottomRightRadius: 4 },
  ];

  const bubbleContent = (
    <>
      {showAi ? (
        <View style={styles.aiLabel}>
          <SymbolView name={{ android: 'auto_awesome', ios: 'sparkles', web: 'auto_awesome' }} size={10} tintColor={theme.accentInk} style={{ marginRight: 2 }} />
          <ThemedText style={{ color: theme.accentInk, fontSize: 10, fontWeight: '700' }}>VACHAT AI</ThemedText>
        </View>
      ) : null}
      {replyTo ? (
        <View style={[styles.quote, { borderLeftColor: theme.accent, backgroundColor: 'rgba(0,0,0,0.03)' }]}>
          <ThemedText type="smallBold" style={{ color: theme.accent }}>
            {replyAuthorLabel(replyTo)}
          </ThemedText>
          <ThemedText numberOfLines={1} style={{ color: theme.textSecondary }} type="small">
            {messagePreview(replyTo)}
          </ThemedText>
        </View>
      ) : null}
      <MessageBody
        message={message}
        onBg={onBg}
        outgoing={outgoing}
        productCard={productCard}
        voiceAvatar={voiceAvatar}
      />
      {isVoice ? null : (
        <View style={styles.footer}>
          <ThemedText style={[styles.meta, { color: metaColor }]}>
            {formatMessageTime(message.created_at)}
          </ThemedText>
          {outgoing ? <MessageStatusTicks color={metaColor} status={message.status} /> : null}
        </View>
      )}
    </>
  );

  return (
    <View style={[styles.row, outgoing && styles.outgoing]}>
      {hasInteractiveContent ? (
        <LongPressGestureHandler
          minDurationMs={280}
          onHandlerStateChange={(event) => {
            if (event.nativeEvent.state === State.ACTIVE) {
              onLongPress();
            }
          }}>
          <View style={bubbleStyle}>{bubbleContent}</View>
        </LongPressGestureHandler>
      ) : (
        <Pressable
          accessibilityRole="button"
          delayLongPress={280}
          onLongPress={onLongPress}
          onPress={
            isOpenableMedia(message, Boolean(productCard))
              ? () => openUrl(message.media_url)
              : undefined
          }
          style={({ pressed }) => [bubbleStyle, pressed && { opacity: 0.9 }]}>
          {bubbleContent}
        </Pressable>
      )}
      {reactions && reactions.length > 0 ? (
        <View style={[styles.reactions, outgoing && styles.reactionsOut]}>
          {reactions.map((reaction) => (
            <ThemedText key={reaction.id} style={styles.reaction}>
              {reaction.emoji}
            </ThemedText>
          ))}
        </View>
      ) : null}
      {outgoing && message.status === 'failed' && onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}>
          <ThemedText type="smallBold" style={{ color: theme.manual }}>
            Retry
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    marginBottom: 6,
    maxWidth: '100%',
  },
  outgoing: {
    alignItems: 'flex-end',
  },
  bubble: {
    borderRadius: 12,
    maxWidth: '88%',
    paddingBottom: 4,
    paddingHorizontal: 10,
    paddingTop: 6,
    boxShadow: '0 1px 0.5px rgba(0, 0, 0, 0.08)',
  },
  outgoingBubble: {
    maxWidth: '88%',
  },
  voiceBubble: {
    paddingBottom: 6,
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  quote: {
    borderLeftWidth: 2,
    marginBottom: 6,
    paddingLeft: 8,
  },
  body: {
    fontSize: 14.5,
    lineHeight: 19,
  },
  media: {
    backgroundColor: '#111',
    borderRadius: 10,
    height: 180,
    marginBottom: 6,
    width: 220,
  },
  mediaFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceWrap: {
    minWidth: 232,
  },
  footer: {
    alignItems: 'center',
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 4,
    marginTop: 4,
  },
  meta: {
    fontSize: 11,
    lineHeight: 14,
  },
  reactions: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 2,
  },
  reactionsOut: {
    justifyContent: 'flex-end',
  },
  reaction: {
    fontSize: 14,
  },
  retry: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: Spacing.one,
  },
  aiLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  pdfCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
    padding: 10,
    gap: 10,
    marginBottom: 4,
    marginTop: 8,
  },
  pdfIconBox: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(220,38,38,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pdfInfo: {
    flex: 1,
    gap: 2,
  },
  pdfName: {
    fontSize: 13,
    fontWeight: '600',
  },
  downloadButton: {
    alignItems: 'center',
    backgroundColor: '#F2F4F7',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
});
