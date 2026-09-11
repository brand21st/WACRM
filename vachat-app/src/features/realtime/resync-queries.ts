import type { QueryClient } from '@tanstack/react-query';

import { logger } from '@/lib/logger';

function invalidateObserved(queryClient: QueryClient, prefix: readonly string[]) {
  for (const query of queryClient.getQueryCache().findAll({ queryKey: prefix })) {
    if (query.queryKey.length < 2) continue;
    if (query.getObserversCount() > 0) {
      void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
    }
  }
}

export function resyncInboxQueries(queryClient: QueryClient) {
  logger.info('[REALTIME] resync');
  void queryClient.invalidateQueries({ queryKey: ['conversations'], exact: true });
  invalidateObserved(queryClient, ['conversations']);
  invalidateObserved(queryClient, ['messages']);
  invalidateObserved(queryClient, ['message-reactions']);
}
