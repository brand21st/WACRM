/** Fired after the inbox full-agent toggle saves so open threads resync. */
export const AI_FULL_AGENT_CHANGED = "wacrm:ai-full-agent-changed";

export function dispatchAiFullAgentChanged(
  accountId: string,
  enabled: boolean,
) {
  window.dispatchEvent(
    new CustomEvent(AI_FULL_AGENT_CHANGED, {
      detail: { accountId, enabled },
    }),
  );
}
