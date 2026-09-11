import { Alert, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { ModalSheet } from '@/features/conversation/modal-sheet';
import { useActiveCatalog } from '@/features/conversation/use-catalog';
import { useTheme } from '@/hooks/use-theme';
import type { CatalogListItem } from '@/types/catalog';

type CatalogSheetProps = {
  visible: boolean;
  enabled: boolean;
  onClose: () => void;
};

function formatPrice(item: CatalogListItem): string {
  if (item.priceMin == null && item.priceMax == null) return '';
  const currency = item.currency ? `${item.currency} ` : '';
  if (item.priceMin != null && item.priceMax != null && item.priceMin !== item.priceMax) {
    return `${currency}${item.priceMin} – ${item.priceMax}`;
  }
  return `${currency}${item.priceMin ?? item.priceMax}`;
}

export function CatalogSheet({ visible, enabled, onClose }: CatalogSheetProps) {
  const theme = useTheme();
  const catalog = useActiveCatalog(visible && enabled);

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      sheetStyle={[styles.sheet, { backgroundColor: theme.surface }]}>
      <View style={styles.header}>
        <ThemedText type="smallBold">Catalog</ThemedText>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.close}>
          <ThemedText type="smallBold">Close</ThemedText>
        </Pressable>
      </View>
      {!enabled ? (
        <ThemedText themeColor="textSecondary" style={styles.pad}>
          Catalog is available to agents.
        </ThemedText>
      ) : catalog.isLoading ? (
        <ThemedText themeColor="textSecondary" style={styles.pad}>
          Loading products…
        </ThemedText>
      ) : catalog.error ? (
        <ThemedText themeColor="textSecondary" style={styles.pad}>
          Couldn’t load the catalog.
        </ThemedText>
      ) : (
        <FlatList
          data={catalog.data ?? []}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.pad}>
              No active products.
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(item.title, 'Sending catalog items comes in a later phase.')
              }
              style={styles.row}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, { backgroundColor: theme.backgroundElement }]} />
              )}
              <View style={styles.meta}>
                <ThemedText numberOfLines={1} type="smallBold">
                  {item.title}
                </ThemedText>
                <ThemedText numberOfLines={1} themeColor="textSecondary" type="small">
                  {formatPrice(item) || item.handle}
                </ThemedText>
              </View>
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
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
    minHeight: 64,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  thumb: {
    borderRadius: 8,
    height: 48,
    width: 48,
  },
  meta: {
    flex: 1,
    minWidth: 0,
  },
});
