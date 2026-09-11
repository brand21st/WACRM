import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function ConversationRowSkeleton() {
  const theme = useTheme();
  const bar = { backgroundColor: theme.backgroundElement };

  return (
    <View style={[styles.row, { backgroundColor: theme.surface }]}>
      <View style={[styles.avatar, bar]} />
      <View style={[styles.body, { borderBottomColor: theme.separator }]}>
        <View style={styles.top}>
          <View style={[styles.name, bar]} />
          <View style={[styles.time, bar]} />
        </View>
        <View style={[styles.preview, bar]} />
      </View>
    </View>
  );
}

export function ConversationListSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }, (_, index) => (
        <ConversationRowSkeleton key={index} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 72,
    paddingLeft: Spacing.three,
  },
  avatar: {
    borderRadius: 26,
    height: 52,
    marginRight: Spacing.three,
    marginVertical: 10,
    width: 52,
  },
  body: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flex: 1,
    justifyContent: 'center',
    paddingBottom: Spacing.two,
    paddingRight: Spacing.three,
    paddingTop: Spacing.two,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  name: {
    borderRadius: 4,
    height: 12,
    width: '46%',
  },
  time: {
    borderRadius: 4,
    height: 10,
    width: 48,
  },
  preview: {
    borderRadius: 4,
    height: 10,
    width: '72%',
  },
});
