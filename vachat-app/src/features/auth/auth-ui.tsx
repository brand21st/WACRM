import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { type ReactNode, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const AUTH = {
  page: '#fbfbfb',
  card: '#ffffff',
  title: '#0f172a',
  subtitle: '#64748b',
  label: '#334155',
  border: '#e2e8f0',
  placeholder: '#94a3b8',
  icon: '#94a3b8',
  input: '#0f172a',
  green: '#007a4d',
  greenPressed: '#006841',
  forgot: '#ff4d4f',
  errorBg: 'rgba(239, 68, 68, 0.08)',
  errorBorder: 'rgba(239, 68, 68, 0.2)',
  errorText: '#dc2626',
  footer: '#475569',
} as const;

export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled">
          <View style={styles.card}>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function AuthTitle({ children }: { children: string }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function AuthSubtitle({ children }: { children: string }) {
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function AuthError({ message }: { message: string }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

type AuthTextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  trailing?: ReactNode;
} & Pick<
  TextInputProps,
  | 'autoComplete'
  | 'autoCapitalize'
  | 'keyboardType'
  | 'secureTextEntry'
  | 'textContentType'
  | 'returnKeyType'
  | 'onSubmitEditing'
  | 'editable'
>;

export function AuthTextField({
  label,
  value,
  onChangeText,
  placeholder,
  trailing,
  ...inputProps
}: AuthTextFieldProps) {
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        <TextInput
          accessibilityLabel={label}
          autoCorrect={false}
          onBlur={() => setFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={AUTH.placeholder}
          spellCheck={false}
          style={[styles.input, trailing ? styles.inputWithIcon : null]}
          value={value}
          {...inputProps}
        />
        {trailing ? <View style={styles.trailing} pointerEvents="box-none">
          {trailing}
        </View> : null}
      </View>
    </View>
  );
}

export function AuthMailIcon() {
  return (
    <SymbolView
      name={{ android: 'mail_outline', ios: 'envelope', web: 'mail_outline' }}
      size={20}
      tintColor={AUTH.icon}
    />
  );
}

export function AuthEyeButton({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={visible ? 'Hide password' : 'Show password'}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}>
      <SymbolView
        name={{
          android: visible ? 'visibility_off' : 'visibility',
          ios: visible ? 'eye.slash' : 'eye',
          web: visible ? 'visibility_off' : 'visibility',
        }}
        size={20}
        tintColor={AUTH.icon}
      />
    </Pressable>
  );
}

export function AuthPrimaryButton({
  label,
  loadingLabel,
  pending,
  onPress,
}: {
  label: string;
  loadingLabel: string;
  pending: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={pending}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primary,
        (pressed || pending) && styles.primaryPressed,
      ]}>
      <Text style={styles.primaryLabel}>{pending ? loadingLabel : label}</Text>
    </Pressable>
  );
}

export function GoogleLogo() {
  return (
    <Image
      contentFit="contain"
      source={require('@/assets/images/google-g.svg')}
      style={styles.googleLogo}
    />
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: AUTH.page,
  },
  flex: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 32,
  },
  card: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    backgroundColor: AUTH.card,
    borderColor: '#f1f5f9',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 40,
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  title: {
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: AUTH.title,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: AUTH.subtitle,
  },
  errorBox: {
    marginTop: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AUTH.errorBorder,
    backgroundColor: AUTH.errorBg,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 14,
    lineHeight: 20,
    color: AUTH.errorText,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: AUTH.label,
  },
  inputWrap: {
    position: 'relative',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AUTH.border,
    backgroundColor: AUTH.card,
  },
  inputWrapFocused: {
    borderColor: AUTH.green,
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    fontSize: 14,
    color: AUTH.input,
  },
  inputWithIcon: {
    paddingRight: 44,
  },
  trailing: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  primary: {
    marginTop: 16,
    height: 48,
    borderRadius: 8,
    backgroundColor: AUTH.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryPressed: {
    backgroundColor: AUTH.greenPressed,
    opacity: 0.92,
  },
  primaryLabel: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  googleLogo: {
    width: 20,
    height: 20,
  },
});
