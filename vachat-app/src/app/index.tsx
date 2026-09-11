import { Redirect } from 'expo-router';

import { useAuth } from '@/features/auth/auth-context';

export default function IndexScreen() {
  const { isLoading, session } = useAuth();

  if (isLoading) return null;
  if (!session) return <Redirect href="/auth/login" />;
  return <Redirect href="/(tabs)/chats" />;
}
