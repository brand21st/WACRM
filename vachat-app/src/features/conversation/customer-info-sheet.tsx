import { Pressable, StyleSheet, View } from 'react-native';

import { ContactAvatar } from '@/components/contact-avatar';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ModalSheet } from '@/features/conversation/modal-sheet';
import { conversationDisplayName } from '@/features/conversations/conversation-filters';
import { useTheme } from '@/hooks/use-theme';
import type { MobileConversation } from '@/types/conversations';

type CustomerInfoSheetProps = {
  visible: boolean;
  conversation: MobileConversation;
  onClose: () => void;
};

export function CustomerInfoSheet({ visible, conversation, onClose }: CustomerInfoSheetProps) {
  const theme = useTheme();
  const name = conversationDisplayName(conversation);
  const phone = conversation.contact?.phone;
  const company = conversation.contact?.company;

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: theme.surface }]}>
      <View style={styles.profile}>
        <ContactAvatar
          contactId={conversation.contact?.id}
          name={conversation.contact?.name}
          phone={phone}
          avatarUrl={conversation.contact?.avatar_url}
          size={72}
        />
        <ThemedText type="smallBold" style={styles.name}>
          {name}
        </ThemedText>
        {company ? (
          <ThemedText themeColor="textSecondary" type="small">
            {company}
          </ThemedText>
        ) : null}
        <ThemedText themeColor="textSecondary" style={styles.phone} selectable>
          {phone || 'No phone on file'}
        </ThemedText>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onClose}
        style={({ pressed }) => [
          styles.done,
          { backgroundColor: theme.accent, opacity: pressed ? 0.8 : 1 },
        ]}>
        <ThemedText type="smallBold" style={{ color: theme.unreadOnAccent }}>
          Done
        </ThemedText>
      </Pressable>
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: Spacing.two,
    padding: Spacing.four,
  },
  profile: {
    alignItems: 'center',
    gap: 6,
    paddingBottom: Spacing.one,
  },
  name: {
    fontSize: 16,
    marginTop: Spacing.one,
  },
  phone: {
    fontSize: 16,
  },
  done: {
    alignItems: 'center',
    borderRadius: 10,
    marginTop: Spacing.two,
    minHeight: 44,
    justifyContent: 'center',
  },
});
