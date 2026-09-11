import * as Linking from 'expo-linking';
import { Link, Redirect, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { getPublicEnv } from '@/constants/env';
import {
  AUTH,
  AuthError,
  AuthEyeButton,
  AuthMailIcon,
  AuthPrimaryButton,
  AuthScreen,
  AuthSubtitle,
  AuthTextField,
  AuthTitle,
  GoogleLogo,
} from '@/features/auth/auth-ui';
import { useAuth } from '@/features/auth/auth-context';
import { signInWithGoogle } from '@/features/auth/google';
import { crmPageUrl, loginErrorFromCallback } from '@/features/auth/oauth';

export default function LoginScreen() {
  const { isLoading, session, signIn } = useAuth();
  const params = useLocalSearchParams<{ error?: string }>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  const [error, setError] = useState<string | null>(() =>
    loginErrorFromCallback(typeof params.error === 'string' ? params.error : undefined),
  );

  if (isLoading) return null;
  if (session) return <Redirect href="/(tabs)/chats" />;

  async function onSignIn() {
    if (pending || googlePending) return;
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await signIn({ email: email.trim(), password });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setPending(false);
    }
  }

  async function onGoogle() {
    if (pending || googlePending) return;
    setGooglePending(true);
    setError(null);
    try {
      const { error: googleError } = await signInWithGoogle();
      if (googleError) setError(googleError.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize Google sign-in.');
    } finally {
      setGooglePending(false);
    }
  }

  function onSignUp() {
    const url = crmPageUrl(getPublicEnv().apiUrl, '/signup');
    if (process.env.EXPO_OS === 'web' && typeof window !== 'undefined') {
      window.location.assign(url);
      return;
    }
    void Linking.openURL(url);
  }

  return (
    <AuthScreen>
      <AuthTitle>Log in</AuthTitle>
      <AuthSubtitle>Welcome back! Please enter your email.</AuthSubtitle>

      {error ? <AuthError message={error} /> : null}

      <View style={styles.form}>
        <AuthTextField
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          label="Email"
          onChangeText={setEmail}
          onSubmitEditing={() => void onSignIn()}
          placeholder="Your Email"
          returnKeyType="next"
          textContentType="emailAddress"
          trailing={<AuthMailIcon />}
          value={email}
        />
        <AuthTextField
          autoCapitalize="none"
          autoComplete="password"
          label="Password"
          onChangeText={setPassword}
          onSubmitEditing={() => void onSignIn()}
          placeholder="Password"
          returnKeyType="go"
          secureTextEntry={!showPassword}
          textContentType="password"
          trailing={
            <AuthEyeButton visible={showPassword} onPress={() => setShowPassword((open) => !open)} />
          }
          value={password}
        />
        <Link href="/auth/forgot-password" asChild>
          <Pressable accessibilityRole="link" style={styles.forgotWrap}>
            <Text style={styles.forgot}>Forgot password?</Text>
          </Pressable>
        </Link>

        <AuthPrimaryButton
          label="LOGIN"
          loadingLabel="LOGGING IN..."
          onPress={() => void onSignIn()}
          pending={pending}
        />

        <Pressable
          accessibilityRole="button"
          disabled={googlePending || pending}
          onPress={() => void onGoogle()}
          style={({ pressed }) => [
            styles.google,
            (pressed || googlePending || pending) && styles.googlePressed,
          ]}>
          <GoogleLogo />
          <Text style={styles.googleLabel}>
            {googlePending ? 'Connecting...' : 'Sign in with Google'}
          </Text>
        </Pressable>
      </View>

      <Text style={styles.footer}>
        {"Don't have an account? "}
        <Text accessibilityRole="link" onPress={onSignUp} style={styles.signup}>
          Sign up
        </Text>
      </Text>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: {
    marginTop: 24,
    gap: 16,
  },
  forgotWrap: {
    alignSelf: 'flex-end',
    marginTop: -8,
  },
  forgot: {
    fontSize: 14,
    color: AUTH.forgot,
  },
  google: {
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AUTH.border,
    backgroundColor: AUTH.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
  },
  googlePressed: {
    opacity: 0.7,
  },
  googleLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: AUTH.label,
  },
  footer: {
    marginTop: 32,
    textAlign: 'center',
    fontSize: 14,
    color: AUTH.footer,
  },
  signup: {
    fontWeight: '600',
    color: AUTH.green,
  },
});
