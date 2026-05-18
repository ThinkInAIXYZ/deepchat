import { ApiEndpointType, ModelType } from './model'

export const VIDEO_GENERATION_ENDPOINT_TYPE = 'video-generation' as const

export type OpenAICompatibleVideoRequestBodyShape = 'extra-body' | 'flat-top-level'

export type VideoGenerationReferenceType = 'image' | 'video' | 'audio'

export interface VideoGenerationReference {
  type: VideoGenerationReferenceType
  url?: string
  data?: string
  mimeType?: string
}

export interface VideoGenerationInputReference {
  data: string
  mimeType?: string
}

export interface VideoGenerationOptions {
  seconds?: string
  size?: string
  ratio?: string
  duration?: number
  resolution?: string
  watermark?: boolean
  generateAudio?: boolean
  inputReference?: string | VideoGenerationInputReference
  references?: VideoGenerationReference[]
}

export interface VideoGenerationDetectionTarget {
  modelId?: unknown
  providerId?: unknown
  providerApiType?: unknown
  providerKind?: unknown
  providerOptionsKey?: unknown
  baseUrl?: unknown
  apiEndpoint?: unknown
  endpointType?: unknown
  supportedEndpointTypes?: readonly unknown[]
  type?: unknown
  modalities?: {
    input?: readonly unknown[]
    output?: readonly unknown[]
  } | null
}

const NON_OPENAI_VIDEO_PROVIDER_HINTS = [
  'anthropic',
  'gemini',
  'vertex',
  'aws-bedrock',
  'github-copilot',
  'ollama',
  'acp',
  'voiceai'
] as const

const FLAT_TOP_LEVEL_VIDEO_PROVIDER_HINTS = ['aihubmix'] as const

const VIDEO_GENERATION_MODEL_ID_PREFIXES = [
  'doubao-seedance-',
  'sora-',
  'veo-',
  'wan2.',
  'jimeng-',
  'happyhorse-'
] as const

const VIDEO_GENERATION_MODEL_ID_MARKERS = [
  'seedance',
  '-t2v',
  '-i2v',
  '-r2v',
  'videoedit',
  'video-edit'
] as const

const normalizeText = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function normalizeModelId(value: unknown): string {
  const normalized = normalizeText(value)
  if (!normalized) {
    return ''
  }

  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized
}

function normalizeStringArray(values: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  return values.map((value) => normalizeText(value)).filter(Boolean)
}

function normalizeVideoReference(value: unknown): VideoGenerationReference | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const type = normalizeText(record.type)
  if (type !== 'image' && type !== 'video' && type !== 'audio') {
    return undefined
  }

  const url = normalizeOptionalString(record.url)
  const data = normalizeOptionalString(record.data)
  const mimeType = normalizeOptionalString(record.mimeType)

  if (!url && !data) {
    return undefined
  }

  return {
    type,
    ...(url ? { url } : {}),
    ...(data ? { data } : {}),
    ...(mimeType ? { mimeType } : {})
  }
}

function normalizeInputReference(
  value: VideoGenerationOptions['inputReference']
): VideoGenerationOptions['inputReference'] | undefined {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? normalized : undefined
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const data = normalizeOptionalString(value.data)
  if (!data) {
    return undefined
  }

  const mimeType = normalizeOptionalString(value.mimeType)
  return {
    data,
    ...(mimeType ? { mimeType } : {})
  }
}

function hasVideoEndpointHint(target: VideoGenerationDetectionTarget): boolean {
  const apiEndpoint = normalizeText(target.apiEndpoint)
  const endpointType = normalizeText(target.endpointType)
  const supportedEndpointTypes = normalizeStringArray(target.supportedEndpointTypes)
  const modelType = normalizeText(target.type)

  return (
    apiEndpoint === ApiEndpointType.Video ||
    endpointType === VIDEO_GENERATION_ENDPOINT_TYPE ||
    supportedEndpointTypes.includes(VIDEO_GENERATION_ENDPOINT_TYPE) ||
    modelType === ModelType.VideoGeneration.toLowerCase()
  )
}

function hasVideoOutputModality(target: VideoGenerationDetectionTarget): boolean {
  const outputModalities = normalizeStringArray(target.modalities?.output)
  return outputModalities.includes('video')
}

export function isVideoGenerationModelId(modelId: string): boolean {
  const normalized = normalizeModelId(modelId)
  if (!normalized) {
    return false
  }

  return (
    VIDEO_GENERATION_MODEL_ID_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    VIDEO_GENERATION_MODEL_ID_MARKERS.some((marker) => normalized.includes(marker))
  )
}

export function resolveVideoGenerationCompatType(
  target: VideoGenerationDetectionTarget
): ModelType | undefined {
  if (hasVideoEndpointHint(target) || hasVideoOutputModality(target)) {
    return ModelType.VideoGeneration
  }

  const modelId = typeof target.modelId === 'string' ? target.modelId : ''
  return isVideoGenerationModelId(modelId) ? ModelType.VideoGeneration : undefined
}

export function isVideoGenerationModelConfig(
  modelConfig: {
    type?: ModelType
    apiEndpoint?: ApiEndpointType
    endpointType?: unknown
    supportedEndpointTypes?: readonly unknown[]
  },
  modelId?: string
): boolean {
  return (
    resolveVideoGenerationCompatType({
      modelId,
      type: modelConfig.type,
      apiEndpoint: modelConfig.apiEndpoint,
      endpointType: modelConfig.endpointType,
      supportedEndpointTypes: modelConfig.supportedEndpointTypes
    }) === ModelType.VideoGeneration
  )
}

export function supportsOpenAICompatibleVideoGeneration(
  target: VideoGenerationDetectionTarget
): boolean {
  const providerId = normalizeText(target.providerId)
  const providerApiType = normalizeText(target.providerApiType)
  const providerKind = normalizeText(target.providerKind)
  const providerOptionsKey = normalizeText(target.providerOptionsKey)

  if (
    NON_OPENAI_VIDEO_PROVIDER_HINTS.some(
      (hint) =>
        providerId.includes(hint) || providerApiType.includes(hint) || providerKind.includes(hint)
    )
  ) {
    return false
  }

  const isOpenAICompatibleProvider =
    providerKind === 'openai-compatible' ||
    providerKind === 'openai-responses' ||
    providerOptionsKey === 'openai' ||
    providerOptionsKey === 'new-api' ||
    providerId === 'openai' ||
    providerId === 'openai-responses' ||
    providerId === 'new-api' ||
    providerApiType === 'openai' ||
    providerApiType === 'openai-compatible' ||
    providerApiType === 'openai-responses' ||
    providerApiType === 'openai_chat' ||
    providerApiType === 'new-api'

  return (
    isOpenAICompatibleProvider &&
    resolveVideoGenerationCompatType(target) === ModelType.VideoGeneration
  )
}

export function resolveOpenAICompatibleVideoRequestBodyShape(
  target: VideoGenerationDetectionTarget
): OpenAICompatibleVideoRequestBodyShape {
  const providerId = normalizeText(target.providerId)
  const providerApiType = normalizeText(target.providerApiType)
  const providerKind = normalizeText(target.providerKind)
  const providerOptionsKey = normalizeText(target.providerOptionsKey)
  const baseUrl = normalizeText(target.baseUrl)
  const modelId = normalizeModelId(target.modelId)

  if (
    FLAT_TOP_LEVEL_VIDEO_PROVIDER_HINTS.some(
      (hint) =>
        providerId.includes(hint) ||
        providerApiType.includes(hint) ||
        providerKind.includes(hint) ||
        providerOptionsKey.includes(hint) ||
        baseUrl.includes(hint)
    )
  ) {
    return 'flat-top-level'
  }

  if (modelId.startsWith('doubao-seedance-')) {
    return 'flat-top-level'
  }

  return 'extra-body'
}

export function normalizeVideoGenerationOptions(
  value: VideoGenerationOptions | null | undefined
): VideoGenerationOptions | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const normalized: VideoGenerationOptions = {}
  const seconds = normalizeOptionalString(value.seconds)
  const size = normalizeOptionalString(value.size)
  const ratio = normalizeOptionalString(value.ratio)
  const resolution = normalizeOptionalString(value.resolution)
  const inputReference = normalizeInputReference(value.inputReference)
  const references = Array.isArray(value.references)
    ? value.references
        .map((item) => normalizeVideoReference(item))
        .filter((item): item is VideoGenerationReference => item !== undefined)
    : []

  if (seconds) {
    normalized.seconds = seconds
  }
  if (size) {
    normalized.size = size
  }
  if (ratio) {
    normalized.ratio = ratio
  }
  if (resolution) {
    normalized.resolution = resolution
  }
  if (typeof value.duration === 'number' && Number.isFinite(value.duration)) {
    normalized.duration = Math.max(-1, Math.round(value.duration))
  }
  if (typeof value.watermark === 'boolean') {
    normalized.watermark = value.watermark
  }
  if (typeof value.generateAudio === 'boolean') {
    normalized.generateAudio = value.generateAudio
  }
  if (inputReference) {
    normalized.inputReference = inputReference
  }
  if (references.length > 0) {
    normalized.references = references
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined
}
