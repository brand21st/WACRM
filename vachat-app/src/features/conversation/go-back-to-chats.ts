import { router } from 'expo-router';

export function goBackToChats() {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace('/(tabs)/chats');
}
