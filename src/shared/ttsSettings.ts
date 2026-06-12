import { ModelType } from './model'

export const TTS_RESPONSE_FORMAT_VALUES = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] as const
export type TtsResponseFormat = (typeof TTS_RESPONSE_FORMAT_VALUES)[number]

export interface TtsSettings {
  voice?: string
  responseFormat?: TtsResponseFormat
  speed?: number
  instructions?: string
}

/**
 * Standard OpenAI-style TTS models that use the /audio/speech endpoint (Pattern A).
 */
export const OPENAI_STANDARD_TTS_MODELS = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'] as const

/**
 * Gemini TTS models that use the generateContent endpoint with AUDIO output.
 */
export const GEMINI_GENERATE_CONTENT_TTS_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-3.1-flash-tts-preview'
] as const

/**
 * Model ID prefixes for TTS models that use the chat completions endpoint
 * with audio output (Pattern B), e.g. xiaomimimo mimo-v2.5-tts series.
 */
export const CHAT_AUDIO_TTS_MODEL_PREFIXES = ['mimo-v', 'xiaomi-mimo-v'] as const
const CHAT_AUDIO_TTS_MODEL_MARKER_PATTERN = /(^|-)tts($|-)/

function normalizeTtsModelId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase()
  if (!trimmed) return ''
  const slashIndex = trimmed.lastIndexOf('/')
  return slashIndex >= 0 ? trimmed.slice(slashIndex + 1) : trimmed
}

/**
 * Returns true if the model uses the standard /audio/speech TTS endpoint (Pattern A).
 */
export function isStandardTtsModel(modelId: string): boolean {
  const id = normalizeTtsModelId(modelId)
  return (OPENAI_STANDARD_TTS_MODELS as readonly string[]).includes(id)
}

/**
 * Returns true if the model uses the Gemini generateContent endpoint for TTS.
 */
export function isGeminiGenerateContentTtsModel(modelId: string): boolean {
  const id = normalizeTtsModelId(modelId)
  return (GEMINI_GENERATE_CONTENT_TTS_MODELS as readonly string[]).includes(id)
}

/**
 * Returns true if the model produces TTS audio via the chat completions endpoint (Pattern B).
 */
export function isChatAudioTtsModel(modelId: string): boolean {
  const id = normalizeTtsModelId(modelId)
  return (
    CHAT_AUDIO_TTS_MODEL_PREFIXES.some((prefix) => id.startsWith(prefix)) &&
    CHAT_AUDIO_TTS_MODEL_MARKER_PATTERN.test(id)
  )
}

/**
 * Returns true if the model is any kind of TTS model (either pattern).
 */
export function isTtsModelId(modelId: string): boolean {
  return (
    isStandardTtsModel(modelId) ||
    isChatAudioTtsModel(modelId) ||
    isGeminiGenerateContentTtsModel(modelId)
  )
}

/**
 * Returns true if modelConfig indicates this is a TTS model.
 */
export function isTtsModelConfig(modelConfig: { type?: ModelType }): boolean {
  return modelConfig.type === ModelType.TTS
}

/**
 * Maps a TtsResponseFormat value to an audio MIME type string.
 */
export function ttsFormatToMimeType(format: TtsResponseFormat | string | undefined): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg'
    case 'opus':
      return 'audio/ogg; codecs=opus'
    case 'aac':
      return 'audio/aac'
    case 'flac':
      return 'audio/flac'
    case 'wav':
      return 'audio/wav'
    case 'pcm':
      return 'audio/pcm'
    default:
      return 'audio/mpeg'
  }
}

/**
 * Normalizes TtsSettings, returning undefined when no valid options are present.
 */
export function normalizeTtsSettings(options?: TtsSettings | null): TtsSettings | undefined {
  if (!options) return undefined
  const result: TtsSettings = {}

  if (typeof options.voice === 'string' && options.voice.trim()) {
    result.voice = options.voice.trim()
  }
  if (
    typeof options.responseFormat === 'string' &&
    (TTS_RESPONSE_FORMAT_VALUES as readonly string[]).includes(options.responseFormat)
  ) {
    result.responseFormat = options.responseFormat as TtsResponseFormat
  }
  if (typeof options.speed === 'number' && Number.isFinite(options.speed)) {
    result.speed = Math.max(0.25, Math.min(4.0, options.speed))
  }
  if (typeof options.instructions === 'string' && options.instructions.trim()) {
    result.instructions = options.instructions.trim()
  }

  return Object.keys(result).length > 0 ? result : undefined
}
