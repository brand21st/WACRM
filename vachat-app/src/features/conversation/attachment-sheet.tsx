import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

export type AttachmentChoice =
  | 'camera'
  | 'gallery'
  | 'document'
  | 'location'
  | 'contact'
  | 'catalog'
  | 'quick-replies'
  | 'poll'
  | 'event';

type AttachTile = {
  id: AttachmentChoice;
  label: string;
  color: string;
  later?: boolean;
  icon: SymbolName;
};

export const ATTACH_TILES: AttachTile[] = [
  {
    id: 'camera',
    label: 'Camera',
    color: '#111B21',
    icon: { android: 'photo_camera', ios: 'camera.fill', web: 'photo_camera' },
  },
  {
    id: 'gallery',
    label: 'Photos',
    color: '#2F80ED',
    icon: { android: 'photo_library', ios: 'photo.on.rectangle', web: 'photo_library' },
  },
  {
    id: 'document',
    label: 'Document',
    color: '#2F80ED',
    icon: { android: 'description', ios: 'doc.fill', web: 'description' },
  },
  {
    id: 'location',
    label: 'Location',
    color: '#25D366',
    later: true,
    icon: { android: 'location_on', ios: 'mappin.and.ellipse', web: 'location_on' },
  },
  {
    id: 'contact',
    label: 'Contact',
    color: '#54656F',
    later: true,
    icon: { android: 'person', ios: 'person.fill', web: 'person' },
  },
  {
    id: 'catalog',
    label: 'Catalog',
    color: '#8D6E63',
    icon: { android: 'storefront', ios: 'storefront.fill', web: 'storefront' },
  },
  {
    id: 'quick-replies',
    label: 'Quick replies',
    color: '#F5C400',
    icon: { android: 'bolt', ios: 'bolt.fill', web: 'bolt' },
  },
  {
    id: 'poll',
    label: 'Poll',
    color: '#111B21',
    later: true,
    icon: { android: 'format_list_bulleted', ios: 'list.bullet.rectangle', web: 'format_list_bulleted' },
  },
  {
    id: 'event',
    label: 'Event',
    color: '#E53935',
    later: true,
    icon: { android: 'event', ios: 'calendar', web: 'event' },
  },
];

type AttachmentSheetProps = {
  onPick: (choice: AttachmentChoice) => void;
};

export function AttachmentSheet({ onPick }: AttachmentSheetProps) {
  const theme = useTheme();

  return (
    <View style={styles.grid}>
      {ATTACH_TILES.map((tile) => (
        <Pressable
          key={tile.id}
          accessibilityLabel={tile.label}
          accessibilityRole="button"
          onPress={() => {
            if (tile.later) {
              Alert.alert(tile.label, 'Coming in a later phase.');
              return;
            }
            onPick(tile.id);
          }}
          style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
          <View style={[styles.circle, { backgroundColor: theme.surfaceLowest }]}>
            <SymbolView name={tile.icon} size={22} tintColor={tile.color} />
          </View>
          <ThemedText style={[styles.label, { color: theme.textSecondary }]}>{tile.label}</ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingBottom: Spacing.four,
    paddingHorizontal: Spacing.two,
    paddingTop: Spacing.one,
  },
  tile: {
    alignItems: 'center',
    paddingVertical: Spacing.two,
    width: '25%',
  },
  pressed: {
    opacity: 0.7,
  },
  circle: {
    alignItems: 'center',
    borderRadius: 28,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.06)',
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 6,
    textAlign: 'center',
  },
});
