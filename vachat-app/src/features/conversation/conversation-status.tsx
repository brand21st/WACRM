import { Pressable, StyleSheet, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { formatWindowRemaining, windowBand } from '@/features/conversation/format-window-remaining';
import { useTheme } from '@/hooks/use-theme';

type ConversationStatusProps = {
  fullAgentOn: boolean;
  isManual: boolean;
  canEditAi: boolean;
  aiPending: boolean;
  expiresAt: string | null;
  now: number;
  onToggleAi: (nextOn: boolean) => void;
};

export function ConversationStatusBar({
  fullAgentOn,
  isManual,
  canEditAi,
  aiPending,
  expiresAt,
  now,
  onToggleAi,
  company,
}: ConversationStatusProps & { company?: string | null }) {
  const theme = useTheme();
  const band = windowBand(expiresAt, now);
  const aiOn = fullAgentOn && !isManual;
  const windowColor =
    band === 'expired' || band === 'critical'
      ? theme.manual
      : band === 'warning'
        ? '#C47D14'
        : theme.textSecondary;
        
  // Online · company · AI ON · 23h 42m left
  const parts = [];
  parts.push({ text: 'Online', color: theme.unread });
  if (company) parts.push({ text: company, color: theme.textSecondary });

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: theme.surfaceLow, borderColor: theme.separator },
      ]}>
      <View style={styles.left}>
        {parts.map((p, i) => (
          <View key={i} style={styles.partRow}>
            {i > 0 && <View style={[styles.dot, { backgroundColor: theme.textSecondary }]} />}
            {i === 0 ? (
              <View style={[styles.presenceDot, { backgroundColor: theme.primary }]} />
            ) : null}
            <ThemedText
              style={[styles.partText, { color: i === 0 ? theme.primary : p.color }]}>
              {p.text}
            </ThemedText>
          </View>
        ))}
      </View>

      <View style={styles.right}>
        <Pressable
          accessibilityLabel={`Chat AI ${aiOn ? 'on' : 'off'}`}
          accessibilityRole="switch"
          accessibilityState={{ checked: aiOn, disabled: aiPending }}
          disabled={aiPending}
          onPress={() => onToggleAi(!aiOn)}
          style={({ pressed }) => [
            styles.aiToggle,
            { backgroundColor: aiOn ? theme.secondaryFixed : theme.surfaceContainer },
            pressed && !aiPending && { opacity: 0.7 },
            aiPending && { opacity: 0.7 },
            !canEditAi && { opacity: 0.85 },
          ]}>
          <SymbolView
            name={{ android: 'auto_awesome', ios: 'sparkles', web: 'auto_awesome' }}
            size={13}
            tintColor={theme.primary}
            style={styles.aiIcon}
          />
          <ThemedText style={[styles.aiText, { color: aiOn ? theme.text : theme.textSecondary }]}>
            AI {aiOn ? 'ON' : 'OFF'}
          </ThemedText>
          <View style={[styles.onlineDot, { backgroundColor: aiOn ? theme.accentInk : theme.textSecondary }]} />
        </Pressable>

        {now !== 0 && (
          <View
            style={[
              styles.windowBox,
              { backgroundColor: theme.surfaceContainer, borderColor: theme.separator },
            ]}>
            <SymbolView
              name={{ android: 'hourglass_empty', ios: 'hourglass', web: 'hourglass_empty' }}
              size={12}
              tintColor={windowColor}
              style={styles.windowIcon}
            />
            <ThemedText type="small" style={{ color: windowColor, fontSize: 11, fontWeight: '500' }}>
              {formatWindowRemaining(expiresAt, now)}
            </ThemedText>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    height: 36,
    paddingHorizontal: Spacing.three,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    flex: 1,
    paddingRight: 8,
  },
  partRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    marginHorizontal: 6,
  },
  partText: {
    fontSize: 11,
    fontWeight: '500',
  },
  presenceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
    gap: 4,
  },
  aiIcon: {
    marginRight: 2,
  },
  aiText: {
    fontSize: 10,
    fontWeight: '700',
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 2,
  },
  windowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  windowIcon: {
    marginRight: 2,
  },
});
