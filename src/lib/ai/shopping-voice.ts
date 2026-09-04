const VOICE_BLOCK = /(?:^|\n)\s*(?:VOICE_MESSAGE|Voice message)\s*:\s*([\s\S]*)$/i

export const VOICE_MESSAGE_HEADING = 'VOICE_MESSAGE:'

export function splitShoppingReply(text: string): {
  chatText: string
  voiceText: string | null
} {
  const raw = text.replace(/\s+$/g, '')
  const match = raw.match(VOICE_BLOCK)
  if (!match || match.index == null) {
    return { chatText: raw.trim(), voiceText: null }
  }
  return {
    chatText: raw.slice(0, match.index).trim(),
    voiceText: match[1].replace(/\s+/g, ' ').trim() || null,
  }
}

export function joinShoppingReply(
  chatText: string,
  voiceText: string | null,
): string {
  const chat = chatText.trim()
  const voice = voiceText?.replace(/\s+/g, ' ').trim() || ''
  if (!voice) return chat
  return chat
    ? `${chat}\n\n${VOICE_MESSAGE_HEADING}\n${voice}`
    : `${VOICE_MESSAGE_HEADING}\n${voice}`
}
