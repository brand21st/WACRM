import { spawn } from 'node:child_process'
import { AiError } from '@/lib/ai/types'
import { ELEVENLABS_WHATSAPP_VOICE_MIME } from '@/lib/elevenlabs/tts'

/** WhatsApp native voice notes: OGG container, Opus codec, mono. */
export const WHATSAPP_VOICE_MIME = ELEVENLABS_WHATSAPP_VOICE_MIME

interface FfmpegChild {
  stdout: NodeJS.ReadableStream
  stderr: NodeJS.ReadableStream
  stdin: NodeJS.WritableStream
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export interface PcmToOpusArgs {
  pcm: Uint8Array
  /** PCM16 little-endian sample rate. OpenAI Realtime audio/pcm is 24000. */
  sampleRate?: number
  /** Injected in tests. */
  spawnFn?: (command: string, args: readonly string[]) => FfmpegChild
  ffmpegPath?: string | null
}

/**
 * Encode raw PCM16 LE mono to OGG/Opus for Meta `voice: true`.
 * Lazy-loads ffmpeg-static so unit tests can inject a fake spawn.
 */
export async function pcm16ToOggOpus(
  args: PcmToOpusArgs,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (args.pcm.byteLength === 0) {
    throw new AiError('Nothing to encode — empty PCM buffer.', {
      code: 'empty_audio',
      status: 400,
    })
  }
  const sampleRate = args.sampleRate ?? 24_000
  const ffmpeg =
    args.ffmpegPath === undefined ? await resolveFfmpegPath() : args.ffmpegPath
  if (!ffmpeg) {
    throw new AiError('ffmpeg is not available to encode voice notes.', {
      code: 'missing_ffmpeg',
      status: 500,
    })
  }

  const spawnFn = args.spawnFn ?? spawn
  const child = spawnFn(ffmpeg, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    's16le',
    '-ar',
    String(sampleRate),
    '-ac',
    '1',
    '-i',
    'pipe:0',
    '-c:a',
    'libopus',
    '-b:a',
    '64k',
    '-application',
    'voip',
    '-f',
    'ogg',
    'pipe:1',
  ]) as FfmpegChild

  return waitForEncode(child, args.pcm)
}

async function resolveFfmpegPath(): Promise<string | null> {
  try {
    const mod = await import('ffmpeg-static')
    const path = (mod.default ?? mod) as unknown
    return typeof path === 'string' && path ? path : null
  } catch {
    return null
  }
}

function waitForEncode(
  child: FfmpegChild,
  pcm: Uint8Array,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => chunks.push(c))
    child.stderr.on('data', (c: Buffer) => errChunks.push(c))
    child.on('error', (err) => {
      const message = err instanceof Error ? err.message : String(err)
      reject(
        new AiError(`ffmpeg failed to start: ${message}`, {
          code: 'ffmpeg_error',
          status: 500,
        }),
      )
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(errChunks).toString('utf8').trim()
        reject(
          new AiError(
            `ffmpeg exited ${code}${detail ? `: ${detail}` : ''}`,
            { code: 'ffmpeg_error', status: 500 },
          ),
        )
        return
      }
      const bytes = Buffer.concat(chunks)
      if (bytes.byteLength === 0) {
        reject(
          new AiError('ffmpeg produced empty OGG output.', {
            code: 'empty_audio',
            status: 502,
          }),
        )
        return
      }
      resolve({ bytes: new Uint8Array(bytes), mimeType: WHATSAPP_VOICE_MIME })
    })
    child.stdin.on('error', () => {
      // stdin errors after close are common; the close handler reports
      // the real outcome.
    })
    child.stdin.end(Buffer.from(pcm))
  })
}
