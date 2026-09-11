import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';

import { getPublicEnv } from '@/constants/env';
import {
  AUTH,
  AuthError,
  AuthMailIcon,
  AuthPrimaryButton,
  AuthScreen,
  AuthSubtitle,
  AuthTextField,
  AuthTitle,
} from '@/features/auth/auth-ui';
import { passwordResetRedirectTo } from '@/features/auth/oauth';
import { getSupabase } from '@/lib/supabase';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function onSubmit() {
    if (pending) return;
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
        redirectTo: passwordResetRedirectTo(getPublicEnv().apiUrl),
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a reset link.');
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <AuthScreen>
        <View style={styles.successIcon}>
          <SymbolView
            name={{ android: 'check_circle', ios: 'checkmark.circle.fill', web: 'check_circle' }}
            size={28}
            tintColor={AUTH.green}
          />
        </View>
        <AuthTitle>Check your email</AuthTitle>
        <AuthSubtitle>{`We've sent a password reset link to ${email}. Please check your inbox.`}</AuthSubtitle>
        <Link href="/auth/login" asChild>
          <Pressable accessibilityRole="button" style={styles.backButton}>
            <Text style={styles.backButtonLabel}>Back to sign in</Text>
          </Pressable>
        </Link>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen>
      <AuthTitle>Reset password</AuthTitle>
      <AuthSubtitle>{"Enter your email and we'll send you a reset link"}</AuthSubtitle>
      {error ? <AuthError message={error} /> : null}
      <View style={styles.form}>
        <AuthTextField
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          label="Email"
          onChangeText={setEmail}
          onSubmitEditing={() => void onSubmit()}
          placeholder="you@example.com"
          returnKeyType="go"
          textContentType="emailAddress"
          trailing={<AuthMailIcon />}
          value={email}
        />
        <AuthPrimaryButton
          label="SEND RESET LINK"
          loadingLabel="SENDING..."
          onPress={() => void onSubmit()}
          pending={pending}
        />
      </View>
      <Link href="/auth/login" asChild>
        <Pressable accessibilityRole="link" style={styles.backLink}>
          <SymbolView
            name={{ android: 'arrow_back', ios: 'arrow.left', web: 'arrow_back' }}
            size={16}
            tintColor={AUTH.subtitle}
          />
          <Text style={styles.backLinkLabel}>Back to sign in</Text>
        </Pressable>
      </Link>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: {
    marginTop: 24,
    gap: 16,
  },
  successIcon: {
    marginBottom: 16,
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 122, 77, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButton: {
    marginTop: 24,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AUTH.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: AUTH.label,
  },
  backLink: {
    marginTop: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  backLinkLabel: {
    fontSize: 14,
    color: AUTH.subtitle,
  },
});
