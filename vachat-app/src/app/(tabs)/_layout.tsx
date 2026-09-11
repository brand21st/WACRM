import { Redirect } from 'expo-router';

import AppTabs from '@/components/app-tabs';
import { useAuth } from '@/features/auth/auth-context';

export default function TabsLayout() {
  const { isLoading, session } = useAuth();

  if (isLoading) return null;
  if (!session) return <Redirect href="/auth/login" />;
  return <AppTabs />;
}
