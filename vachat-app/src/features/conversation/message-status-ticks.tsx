import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import type { Message } from '@/types/messages';

type MessageStatusTicksProps = {
  status: Message['status'];
  color: string;
};

export function MessageStatusTicks({ status, color }: MessageStatusTicksProps) {
  if (status === 'sending') {
    return <ThemedText style={[styles.meta, { color }]}>•</ThemedText>;
  }
  if (status === 'sent') {
    return <ThemedText style={[styles.meta, { color }]}>✓</ThemedText>;
  }
  if (status === 'delivered') {
    return <ThemedText style={[styles.meta, { color }]}>✓✓</ThemedText>;
  }
  if (status === 'read') {
    return <ThemedText style={[styles.meta, { color: '#53BDEB' }]}>✓✓</ThemedText>;
  }
  if (status === 'failed') {
    return <ThemedText style={[styles.meta, { color: '#E74C3C' }]}>!</ThemedText>;
  }
  return null;
}

const styles = StyleSheet.create({
  meta: {
    fontSize: 11,
    lineHeight: 14,
  },
});
