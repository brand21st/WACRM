import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const INITIATIVES = ['Purchase', 'Product Inquiry', 'Follow-up', 'Closing'];

type InitiativeChipRowProps = {
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
};

export function InitiativeChipRow({ selectedTag, onSelectTag }: InitiativeChipRowProps) {
  const theme = useTheme();

  return (
    <View style={[styles.wrap, { backgroundColor: theme.surface, borderBottomColor: theme.separator }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}>
        <ThemedText style={[styles.label, { color: theme.textSecondary }]}>Initiatives:</ThemedText>
        {INITIATIVES.map((tag) => {
          const selected = tag === selectedTag;
          return (
            <Pressable
              key={tag}
              onPress={() => onSelectTag(selected ? null : tag)}
              style={[
                styles.chip,
                {
                  backgroundColor: selected ? theme.accent : theme.surfaceLowest,
                  borderColor: selected ? theme.accent : theme.separator,
                }
              ]}>
              <ThemedText style={[{ color: selected ? theme.unreadOnAccent : theme.text, fontSize: 11 }]}>
                {tag}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>
      <Pressable style={styles.selectBtn} onPress={() => {}}>
        <SymbolView name={{ android: 'tune', ios: 'slider.horizontal.3', web: 'tune' }} size={14} tintColor={theme.accentInk} style={styles.icon} />
        <ThemedText style={{ color: theme.accentInk, fontSize: 11, fontWeight: '600' }}>Select</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: {
    flex: 1,
  },
  content: {
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
    marginRight: 2,
  },
  chip: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: Spacing.two,
  },
  icon: {
    marginRight: 2,
  },
});
