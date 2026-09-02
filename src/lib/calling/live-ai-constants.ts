export const TRANSFER_TO_HUMAN_TOOL = 'transfer_to_human'
export const SEARCH_KNOWLEDGE_TOOL = 'search_knowledge'

/** Auto-reply when the caller stops speaking. Sent on session create and session.update. */
export const LIVE_AI_TURN_DETECTION = {
  type: 'server_vad' as const,
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 600,
  create_response: true,
  interrupt_response: true,
}
