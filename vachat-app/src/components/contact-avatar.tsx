import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { contactAvatarColor, contactInitials } from '@/lib/contacts/avatar';

export type ContactAvatarProps = {
  contactId?: string | null;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

function fontSizeFor(size: number): number {
  if (size >= 72) return 24;
  if (size >= 56) return 18;
  if (size >= 48) return 15;
  return 13;
}

export function ContactAvatar({
  contactId,
  name,
  phone,
  avatarUrl,
  size = 48,
  style,
}: ContactAvatarProps) {
  const initials = contactInitials(name, phone);
  const color = contactAvatarColor(contactId || name || phone || initials);
  const displayName = name || phone || initials;

  return (
    <View
      accessibilityLabel={displayName}
      style={[
        styles.avatar,
        {
          backgroundColor: color.bg,
          borderRadius: size / 2,
          height: size,
          width: size,
        },
        style,
      ]}>
      {avatarUrl ? (
        <Image accessibilityLabel="" source={{ uri: avatarUrl }} style={{ height: size, width: size }} />
      ) : (
        <ThemedText style={{ color: color.fg, fontSize: fontSizeFor(size), fontWeight: '600' }}>
          {initials}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
