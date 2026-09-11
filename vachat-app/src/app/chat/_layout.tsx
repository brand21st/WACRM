import { Redirect } from 'expo-router';
import { Stack } from 'expo-router/stack';

import { useAuth } from '@/features/auth/auth-context';

export default function ChatLayout() {
  const { isLoading, session } = useAuth();

  if (isLoading) return null;
  if (!session) return <Redirect href="/auth/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
