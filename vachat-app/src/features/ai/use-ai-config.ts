import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchAiConfig, updateAiConfig } from '@/api/ai-config';
import { useAuth } from '@/features/auth/auth-context';
import type { AiConfigResponse, UpdateAiConfigBody } from '@/types/ai';
import { isFullAgentOn } from '@/types/ai';

export const AI_CONFIG_QUERY_KEY = ['ai-config'] as const;

export function useAiConfig() {
  const { accessToken } = useAuth();

  return useQuery({
    queryKey: AI_CONFIG_QUERY_KEY,
    queryFn: ({ signal }) => fetchAiConfig(signal),
    enabled: Boolean(accessToken),
  });
}

export function useFullAgentOn(): boolean {
  const query = useAiConfig();
  return isFullAgentOn(query.data);
}

export function useUpdateAiConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateAiConfigBody) => updateAiConfig(body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: AI_CONFIG_QUERY_KEY });
      const previous = queryClient.getQueryData<AiConfigResponse>(AI_CONFIG_QUERY_KEY);
      queryClient.setQueryData<AiConfigResponse>(AI_CONFIG_QUERY_KEY, {
        configured: true,
        ...previous,
        full_agent_enabled: body.full_agent_enabled,
        ...(body.full_agent_enabled
          ? { auto_reply_enabled: true, is_active: true }
          : {}),
      });
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(AI_CONFIG_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (_error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(AI_CONFIG_QUERY_KEY, context.previous);
      }
    },
  });
}
