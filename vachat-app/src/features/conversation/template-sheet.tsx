import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ModalSheet } from '@/features/conversation/modal-sheet';
import { useApprovedTemplates } from '@/features/conversation/use-messages';
import { useTheme } from '@/hooks/use-theme';
import type { ApprovedTemplate } from '@/types/messages';

function hasVariables(body: string): boolean {
  return /\{\{\d+\}\}/.test(body);
}

type TemplateSheetProps = {
  visible: boolean;
  onClose: () => void;
  onSend: (template: ApprovedTemplate) => void;
};

export function TemplateSheet({ visible, onClose, onSend }: TemplateSheetProps) {
  const theme = useTheme();
  const templates = useApprovedTemplates();

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Approved templates</ThemedText>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
          <ThemedText type="smallBold">Close</ThemedText>
        </Pressable>
      </View>
      {templates.isLoading ? (
        <ThemedText themeColor="textSecondary" style={styles.pad}>
          Loading templates…
        </ThemedText>
      ) : templates.error ? (
        <ThemedText themeColor="textSecondary" style={styles.pad}>
          Couldn’t load templates.
        </ThemedText>
      ) : (
        <FlatList
          data={templates.data ?? []}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.pad}>
              No approved templates.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (hasVariables(item.body_text ?? '')) {
                  Alert.alert(
                    item.name,
                    'This template needs variables. Send it from the web inbox for now.',
                  );
                  return;
                }
                onSend(item);
                onClose();
              }}
              style={styles.row}>
              <ThemedText type="smallBold">{item.name}</ThemedText>
              <ThemedText numberOfLines={2} themeColor="textSecondary" type="small">
                {item.body_text}
              </ThemedText>
            </Pressable>
          )}
        />
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '72%',
    paddingBottom: Spacing.four,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  close: {
    minHeight: 36,
    justifyContent: 'center',
  },
  pad: {
    padding: Spacing.three,
  },
  row: {
    gap: 4,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
