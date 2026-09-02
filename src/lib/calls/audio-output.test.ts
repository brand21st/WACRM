import { describe, it, expect } from 'vitest'
import { applySpeakerOutput, pickAudioOutputId, RemoteCallAudio } from './audio-output'

const devices = [
  { deviceId: 'default', kind: 'audiooutput', label: 'Default' },
  { deviceId: 'speakers', kind: 'audiooutput', label: 'Speakers (Realtek)' },
  { deviceId: 'headset', kind: 'audiooutput', label: 'Headset Earphone (USB)' },
  { deviceId: 'mic', kind: 'audioinput', label: 'Microphone' },
]

describe('pickAudioOutputId', () => {
  it('prefers a loudspeaker device when speaker is on', () => {
    expect(pickAudioOutputId(devices, true)).toBe('speakers')
  })

  it('prefers headset/earpiece when speaker is off', () => {
    expect(pickAudioOutputId(devices, false)).toBe('headset')
  })

  it('falls back to the browser default when no match exists', () => {
    const onlyDefault = [
      { deviceId: 'default', kind: 'audiooutput', label: 'Default' },
    ]
    expect(pickAudioOutputId(onlyDefault, true)).toBe('')
    expect(pickAudioOutputId(onlyDefault, false)).toBe('')
  })
})

describe('applySpeakerOutput', () => {
  function fakeAudio() {
    return {
      muted: false,
      volume: 0.5,
      play: async () => {},
    } as HTMLAudioElement
  }

  it('unmutes and plays when speaker is on', async () => {
    const el = fakeAudio()
    el.muted = true
    await applySpeakerOutput(el, true)
    expect(el.muted).toBe(false)
    expect(el.volume).toBe(1)
  })

  it('mutes remote playback when speaker is off', async () => {
    const el = fakeAudio()
    await applySpeakerOutput(el, false)
    expect(el.muted).toBe(true)
    expect(el.volume).toBe(0)
  })
})

describe('RemoteCallAudio', () => {
  it('turns element volume off when speaker is off', () => {
    const player = new RemoteCallAudio()
    const el = {
      muted: false,
      volume: 1,
      srcObject: null as MediaStream | null,
      autoplay: false,
      play: async () => {},
    } as HTMLAudioElement
    const stream = { getAudioTracks: () => [] } as unknown as MediaStream
    player.attach(stream, true, el)
    expect(el.volume).toBe(1)
    player.setSpeaker(false)
    expect(el.volume).toBe(0)
    expect(el.muted).toBe(true)
    player.setSpeaker(true)
    expect(el.volume).toBe(1)
    expect(el.muted).toBe(false)
    player.silence()
    expect(el.volume).toBe(0)
    expect(el.muted).toBe(true)
  })
})
