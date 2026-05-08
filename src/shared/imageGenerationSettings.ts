import { ApiEndpointType, ModelType } from './model'

export const OPENAI_IMAGE_GENERATION_MODEL_ID_FALLBACK = 'gpt-image-2'

export const IMAGE_GENERATION_QUALITY_VALUES = ['low', 'medium', 'high', 'auto'] as const
export const IMAGE_GENERATION_OUTPUT_FORMAT_VALUES = ['png', 'jpeg', 'webp'] as const
export const OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES = ['auto', 'opaque'] as const
export const IMAGE_GENERATION_MODERATION_VALUES = ['auto', 'low'] as const

export const OPENAI_IMAGE_GENERATION_SIZE_PRESETS = [
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '2048x2048',
  '2048x1152',
  '3840x2160',
  '2160x3840'
] as const

export const OPENAI_IMAGE_GENERATION_EXPERIMENTAL_PIXEL_THRESHOLD = 2560 * 1440
export const OPENAI_IMAGE_GENERATION_MIN_PIXELS = 655360
export const OPENAI_IMAGE_GENERATION_MAX_PIXELS = 8294400
export const OPENAI_IMAGE_GENERATION_MAX_SIDE = 3840
export const OPENAI_IMAGE_GENERATION_MAX_ASPECT_RATIO = 3
export const OPENAI_IMAGE_GENERATION_SIZE_MULTIPLE = 16

export type ImageGenerationQuality = (typeof IMAGE_GENERATION_QUALITY_VALUES)[number]
export type ImageGenerationOutputFormat = (typeof IMAGE_GENERATION_OUTPUT_FORMAT_VALUES)[number]
export type OpenAIImageGenerationBackground =
  (typeof OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES)[number]
export type ImageGenerationModeration = (typeof IMAGE_GENERATION_MODERATION_VALUES)[number]

export interface OpenAIImageGenerationSettingsTarget {
  providerId?: unknown
  providerApiType?: unknown
  providerKind?: unknown
  providerOptionsKey?: unknown
  modelId?: unknown
  apiEndpoint?: unknown
  endpointType?: unknown
  supportedEndpointTypes?: readonly unknown[]
  type?: unknown
}

export interface ImageGenerationOptions {
  size?: string
  quality?: ImageGenerationQuality
  outputFormat?: ImageGenerationOutputFormat
  outputCompression?: number
  background?: OpenAIImageGenerationBackground
  moderation?: ImageGenerationModeration
}

export type OpenAIImageGenerationSizeValidationCode =
  | 'invalid_format'
  | 'invalid_multiple'
  | 'side_too_large'
  | 'aspect_ratio_too_large'
  | 'pixel_count_out_of_range'

export interface OpenAIImageGenerationSizeValidationResult {
  code: OpenAIImageGenerationSizeValidationCode | null
  experimental: boolean
  width?: number
  height?: number
}

const hasOwn = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && values.includes(value as T)

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

const NON_OPENAI_IMAGE_PROVIDER_HINTS = [
  'anthropic',
  'gemini',
  'vertex',
  'aws-bedrock',
  'github-copilot',
  'ollama',
  'acp',
  'voiceai',
  'xai',
  'grok'
] as const

const isOpenAICompatibleProvider = (target: OpenAIImageGenerationSettingsTarget): boolean => {
  const providerId = normalizeText(target.providerId)
  const providerApiType = normalizeText(target.providerApiType)
  const providerKind = normalizeText(target.providerKind)
  const providerOptionsKey = normalizeText(target.providerOptionsKey)

  if (
    NON_OPENAI_IMAGE_PROVIDER_HINTS.some(
      (hint) =>
        providerId.includes(hint) || providerApiType.includes(hint) || providerKind.includes(hint)
    )
  ) {
    return false
  }

  if (providerKind === 'openai-responses' || providerKind === 'openai-compatible') {
    return true
  }

  if (providerOptionsKey === 'openai' || providerOptionsKey === 'new-api') {
    return true
  }

  if (providerId === 'openai' || providerId === 'openai-responses' || providerId === 'new-api') {
    return true
  }

  if (
    providerApiType === 'openai' ||
    providerApiType === 'openai-responses' ||
    providerApiType === 'openai-compatible' ||
    providerApiType === 'openai-completions' ||
    providerApiType === 'new-api' ||
    providerApiType === 'openai_chat'
  ) {
    return true
  }

  return false
}

const hasOpenAIImageGenerationRoute = (target: OpenAIImageGenerationSettingsTarget): boolean => {
  const modelId = normalizeText(target.modelId)
  const apiEndpoint = normalizeText(target.apiEndpoint)
  const endpointType = normalizeText(target.endpointType)
  const modelType = normalizeText(target.type)

  return (
    apiEndpoint === ApiEndpointType.Image ||
    endpointType === 'image-generation' ||
    modelType === ModelType.ImageGeneration.toLowerCase() ||
    modelId.includes(OPENAI_IMAGE_GENERATION_MODEL_ID_FALLBACK)
  )
}

const parseSize = (size: string): { width: number; height: number } | null => {
  const match = size.trim().match(/^(\d+)x(\d+)$/)
  if (!match) {
    return null
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

export const supportsOpenAIImageGenerationSettings = (
  target: OpenAIImageGenerationSettingsTarget
): boolean => isOpenAICompatibleProvider(target) && hasOpenAIImageGenerationRoute(target)

export const validateOpenAIImageGenerationSize = (
  size: string
): OpenAIImageGenerationSizeValidationResult => {
  const parsed = parseSize(size)
  if (!parsed) {
    return { code: 'invalid_format', experimental: false }
  }

  const { width, height } = parsed
  const pixels = width * height
  const aspectRatio = Math.max(width, height) / Math.min(width, height)
  const experimental = pixels > OPENAI_IMAGE_GENERATION_EXPERIMENTAL_PIXEL_THRESHOLD

  if (
    width % OPENAI_IMAGE_GENERATION_SIZE_MULTIPLE !== 0 ||
    height % OPENAI_IMAGE_GENERATION_SIZE_MULTIPLE !== 0
  ) {
    return { code: 'invalid_multiple', experimental, width, height }
  }

  if (width > OPENAI_IMAGE_GENERATION_MAX_SIDE || height > OPENAI_IMAGE_GENERATION_MAX_SIDE) {
    return { code: 'side_too_large', experimental, width, height }
  }

  if (aspectRatio > OPENAI_IMAGE_GENERATION_MAX_ASPECT_RATIO) {
    return { code: 'aspect_ratio_too_large', experimental, width, height }
  }

  if (pixels < OPENAI_IMAGE_GENERATION_MIN_PIXELS || pixels > OPENAI_IMAGE_GENERATION_MAX_PIXELS) {
    return { code: 'pixel_count_out_of_range', experimental, width, height }
  }

  return { code: null, experimental, width, height }
}

export const isValidOpenAIImageGenerationSize = (size: string): boolean =>
  validateOpenAIImageGenerationSize(size).code === null

export const normalizeImageGenerationOptions = (
  value: ImageGenerationOptions | null | undefined
): ImageGenerationOptions | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const normalized: ImageGenerationOptions = {}
  const size = typeof value.size === 'string' ? value.size.trim() : ''

  if (size && isValidOpenAIImageGenerationSize(size)) {
    normalized.size = size
  }

  if (hasOwn(IMAGE_GENERATION_QUALITY_VALUES, value.quality)) {
    normalized.quality = value.quality
  }

  if (hasOwn(IMAGE_GENERATION_OUTPUT_FORMAT_VALUES, value.outputFormat)) {
    normalized.outputFormat = value.outputFormat
  }

  if (hasOwn(OPENAI_IMAGE_GENERATION_BACKGROUND_VALUES, value.background)) {
    normalized.background = value.background
  }

  if (hasOwn(IMAGE_GENERATION_MODERATION_VALUES, value.moderation)) {
    normalized.moderation = value.moderation
  }

  const canUseCompression = normalized.outputFormat === 'jpeg' || normalized.outputFormat === 'webp'
  if (
    canUseCompression &&
    typeof value.outputCompression === 'number' &&
    Number.isFinite(value.outputCompression)
  ) {
    normalized.outputCompression = Math.min(100, Math.max(0, Math.round(value.outputCompression)))
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}
