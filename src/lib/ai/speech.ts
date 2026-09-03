import type { AiConfig } from './types'
import { hasSpeechKey } from './voice'
import {
  speechToText as elevenLabsStt,
} from '@/lib/elevenlabs/stt'
import {
  textToSpeech as elevenLabsTts,
  ELEVENLABS_TTS_MIME,
  ELEVENLABS_WHATSAPP_VOICE_FORMAT,
  ELEVENLABS_WHATSAPP_VOICE_MIME,
} from '@/lib/elevenlabs/tts'
import { speechToText as sarvamStt } from '@/lib/sarvam/stt'
import { textToSpeech as sarvamTts } from '@/lib/sarvam/tts'
import {
  SARVAM_TTS_MIME_MP3,
  SARVAM_TTS_MIME_OPUS,
  SARVAM_WHATSAPP_CODEC,
} from '@/lib/sarvam/limits'
import { effectiveVoiceId } from './voice'
import {
  detectElevenLabsLanguage,
  detectSarvamLanguage,
  isIndicScript,
} from './indic-language'
import { prepareIndicSpeechText } from './speech-text'
import { sarvamCodeFromIso } from './language-lock'
import { DEFAULT_SARVAM_PACE } from './voice'

const INDIC_SARVAM_PACE = 0.9

export interface TranscribeArgs {
  config: AiConfig
  audio: Uint8Array | ArrayBuffer | Buffer
  mimeType: string
  fileName?: string
  /**
   * ISO 639-1 from a hard language lock. Omit on the first turn so STT
   * auto-detects. Never pass a soft cron guess.
   */
  languageHint?: string | null
}

export interface SynthesizeArgs {
  config: AiConfig
  text: string
  /** WhatsApp native voice note (ogg/opus). Browser preview uses mp3. */
  whatsapp?: boolean
  /** Override ElevenLabs model (live calls use a faster flash model). */
  modelId?: string
  /**
   * ISO 639-1 hint from the customer turn (Manglish → `ml`). Preferred
   * over detecting language from the generated reply so English-leaking
   * drafts still speak as the customer’s language.
   */
  languageHint?: string | null
}

export interface SynthesizeResult {
  bytes: Uint8Array
  mimeType: string
}

/** True when STT can run for this config. */
export function canTranscribe(config: AiConfig): boolean {
  return config.sttEnabled && hasSpeechKey(config)
}

/** True when TTS can run for this config. */
export function canSpeak(config: AiConfig): boolean {
  return config.ttsEnabled && hasSpeechKey(config)
}

export async function transcribeSpeech(args: TranscribeArgs): Promise<string> {
  const { config } = args
  const hint = args.languageHint?.trim() || ''
  if (config.voiceProvider === 'sarvam' && config.sarvamApiKey) {
    return sarvamStt({
      apiKey: config.sarvamApiKey,
      audio: args.audio,
      mimeType: args.mimeType,
      fileName: args.fileName,
      languageCode: hint ? sarvamCodeFromIso(hint) : 'unknown',
    })
  }
  return elevenLabsStt({
    apiKey: config.elevenlabsApiKey!,
    audio: args.audio,
    mimeType: args.mimeType,
    fileName: args.fileName,
    ...(hint ? { languageCode: hint } : {}),
  })
}

export async function synthesizeSpeech(
  args: SynthesizeArgs,
): Promise<SynthesizeResult> {
  const { config } = args
  const text = prepareIndicSpeechText(args.text, args.languageHint)
  if (config.voiceProvider === 'sarvam' && config.sarvamApiKey) {
    const indic = isIndicScript(text)
    const pace =
      indic && config.sarvamPace === DEFAULT_SARVAM_PACE
        ? INDIC_SARVAM_PACE
        : config.sarvamPace
    const spoken = await sarvamTts({
      apiKey: config.sarvamApiKey,
      text,
      speaker: config.sarvamSpeaker,
      languageCode: detectSarvamLanguage(text) ?? config.sarvamLanguageCode,
      pace,
      temperature: config.sarvamTemperature,
      outputAudioCodec: args.whatsapp ? SARVAM_WHATSAPP_CODEC : 'mp3',
    })
    return {
      bytes: spoken.bytes,
      mimeType:
        spoken.mimeType ||
        (args.whatsapp ? SARVAM_TTS_MIME_OPUS : SARVAM_TTS_MIME_MP3),
    }
  }
  const elevenLanguage =
    args.languageHint ?? detectElevenLabsLanguage(text) ?? null
  const spoken = await elevenLabsTts({
    apiKey: config.elevenlabsApiKey!,
    voiceId: effectiveVoiceId(config.elevenlabsVoiceId),
    text,
    ...(args.modelId ? { modelId: args.modelId } : {}),
    ...(elevenLanguage ? { languageCode: elevenLanguage } : {}),
    ...(args.whatsapp
      ? { outputFormat: ELEVENLABS_WHATSAPP_VOICE_FORMAT }
      : {}),
  })
  return {
    bytes: spoken.bytes,
    mimeType:
      spoken.mimeType ||
      (args.whatsapp ? ELEVENLABS_WHATSAPP_VOICE_MIME : ELEVENLABS_TTS_MIME),
  }
}
