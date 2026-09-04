import { describe, it, expect } from 'vitest'
import { splitShoppingReply } from './shopping-voice'

describe('splitShoppingReply', () => {
  it('strips VOICE_MESSAGE from the chat bubble', () => {
    const split = splitShoppingReply(
      'First card is the best pick at 1799 rupees.\n\nVOICE_MESSAGE:\nFirst option is my pick. 1799 rupees. Stretch a bit for the premium if you want better material.',
    )
    expect(split.chatText).toBe('First card is the best pick at 1799 rupees.')
    expect(split.voiceText).toMatch(/First option is my pick/)
    expect(split.voiceText).not.toMatch(/VOICE_MESSAGE/)
  })

  it('returns the full text when there is no voice block', () => {
    expect(splitShoppingReply('It is washable.')).toEqual({
      chatText: 'It is washable.',
      voiceText: null,
    })
  })
})
