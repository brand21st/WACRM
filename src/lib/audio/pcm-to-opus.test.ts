import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, it, expect } from 'vitest'
import { pcm16ToOggOpus, WHATSAPP_VOICE_MIME } from './pcm-to-opus'

function fakeSpawn() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const ee = new EventEmitter()
  stdin.on('finish', () => {
    stdout.write(Buffer.from('OggS-fake'))
    stdout.end()
    ee.emit('close', 0)
  })
  return {
    stdout,
    stderr,
    stdin,
    on: ee.on.bind(ee),
  }
}

describe('pcm16ToOggOpus', () => {
  it('encodes PCM through the injected ffmpeg spawn', async () => {
    const out = await pcm16ToOggOpus({
      pcm: new Uint8Array([0, 0, 1, 0]),
      sampleRate: 24000,
      ffmpegPath: '/usr/bin/ffmpeg',
      spawnFn: (_command, _args) => fakeSpawn(),
    })
    expect(out.mimeType).toBe(WHATSAPP_VOICE_MIME)
    expect(Buffer.from(out.bytes).toString()).toBe('OggS-fake')
  })

  it('rejects an empty buffer before spawning', async () => {
    await expect(
      pcm16ToOggOpus({ pcm: new Uint8Array(), ffmpegPath: '/usr/bin/ffmpeg' }),
    ).rejects.toMatchObject({ code: 'empty_audio' })
  })
})
