import { type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type ModalSheetProps = {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  sheetStyle?: StyleProp<ViewStyle>;
  align?: 'bottom' | 'center';
};

export function ModalSheet({
  visible,
  onClose,
  children,
  sheetStyle,
  align = 'bottom',
}: ModalSheetProps) {
  return (
    <Modal
      animationType={align === 'center' ? 'fade' : 'slide'}
      transparent
      visible={visible}
      onRequestClose={onClose}>
      <View style={[styles.backdrop, align === 'center' && styles.center]}>
        <Pressable
          accessibilityLabel="Dismiss"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={sheetStyle}>{children}</View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.35)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
});
