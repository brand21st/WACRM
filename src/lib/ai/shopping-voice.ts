const VOICE_BLOCK = /(?:^|\n)\s*VOICE_MESSAGE:\s*([\s\S]*)$/i

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
