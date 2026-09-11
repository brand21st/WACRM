import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContactAvatar } from '@/components/contact-avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { IncomingBannerPayload } from '@/lib/notifications/push';

export function IncomingMessageBanner({
  payload,
  onDismiss,
}: {
  payload: IncomingBannerPayload;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Animated.View
      entering={FadeInUp.duration(180)}
      exiting={FadeOutUp.duration(140)}
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: insets.top + Spacing.one }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${payload.title}. ${payload.body}`}
        onPress={() => {
          onDismiss();
          router.push({ pathname: '/chat/[id]', params: { id: payload.conversationId } });
        }}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: theme.surfaceLowest,
            opacity: pressed ? 0.92 : 1,
            shadowColor: theme.text,
          },
        ]}>
        <ContactAvatar
          contactId={payload.contactId}
          name={payload.name}
          phone={payload.phone}
          avatarUrl={payload.avatarUrl}
          size={40}
        />
        <View style={styles.copy}>
          <ThemedText type="smallBold" numberOfLines={1}>
            {payload.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {payload.body}
          </ThemedText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 40,
    paddingHorizontal: Spacing.three,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
});
