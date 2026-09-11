import { StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ContactAvatar } from '@/components/contact-avatar';

type VoiceNoteAvatarProps = {
  contactId?: string | null;
  name?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  micColor: string;
};

export function VoiceNoteAvatar({
  contactId,
  name,
  phone,
  avatarUrl,
  micColor,
}: VoiceNoteAvatarProps) {
  return (
    <View style={styles.wrap}>
      <ContactAvatar contactId={contactId} name={name} phone={phone} avatarUrl={avatarUrl} size={40} />
      <View style={[styles.mic, { backgroundColor: micColor }]}>
        <SymbolView
          name={{ android: 'mic', ios: 'mic.fill', web: 'mic' }}
          size={9}
          tintColor="#FFFFFF"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 40,
    width: 40,
  },
  mic: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1.5,
    bottom: -1,
    height: 16,
    justifyContent: 'center',
    position: 'absolute',
    right: -2,
    width: 16,
  },
});
