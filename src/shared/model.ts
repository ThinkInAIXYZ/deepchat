// src/shared/presenter.ts
// Implement enum and runtime exports to avoid Vite errors

export enum ModelType {
  Chat = 'chat',
  Embedding = 'embedding',
  Rerank = 'rerank',
  ImageGeneration = 'imageGeneration',
  VideoGeneration = 'videoGeneration',
  TTS = 'tts'
}

export enum ApiEndpointType {
  Chat = 'chat',
  Image = 'image',
  Video = 'video',
  AudioSpeech = 'audio-speech'
}

export const NEW_API_ENDPOINT_TYPES = [
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'image-generation',
  'video-generation'
] as const

export type NewApiEndpointType = (typeof NEW_API_ENDPOINT_TYPES)[number]

export type NewApiCapabilityProviderId = 'openai' | 'anthropic' | 'gemini'

export type NewApiRouteMeta = {
  endpointType?: NewApiEndpointType
  supportedEndpointTypes?: NewApiEndpointType[]
  type?: ModelType
  providerApiType?: string
  ownedBy?: string
  capabilityProviderId?: string
}

type NewApiSpecialEndpointType = Extract<NewApiEndpointType, 'anthropic' | 'gemini'>

const NEW_API_CHAT_ENDPOINT_TYPES: readonly NewApiEndpointType[] = [
  'openai',
  'openai-response',
  'anthropic',
  'gemini'
] as const

const OPENAI_COMPATIBLE_NEW_API_ENDPOINT_TYPES: readonly NewApiEndpointType[] = ['openai'] as const

export const isNewApiEndpointType = (value: unknown): value is NewApiEndpointType =>
  typeof value === 'string' && NEW_API_ENDPOINT_TYPES.includes(value as NewApiEndpointType)

function normalizeModelId(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeProviderValue(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeRouteHintValue(value: string | undefined): string {
  return normalizeProviderValue(value).replace(/[./_-]+/g, ' ')
}

export function isNewApiResponsesIncompatibleModelId(modelId: string | undefined): boolean {
  const normalizedModelId = normalizeModelId(modelId)
  return (
    normalizedModelId.startsWith('tts-') ||
    normalizedModelId.startsWith('whisper-') ||
    normalizedModelId.startsWith('audio-') ||
    normalizedModelId.startsWith('dall-e-') ||
    normalizedModelId.startsWith('gpt-image-') ||
    normalizedModelId.startsWith('sora-') ||
    normalizedModelId.includes('embedding') ||
    normalizedModelId.includes('embed') ||
    normalizedModelId.includes('rerank') ||
    normalizedModelId.includes('speech') ||
    normalizedModelId.includes('transcribe') ||
    normalizedModelId.includes('moderation')
  )
}

function isExplicitNonChatNewApiModelType(type: ModelType | undefined): boolean {
  return (
    type === ModelType.Embedding ||
    type === ModelType.Rerank ||
    type === ModelType.ImageGeneration ||
    type === ModelType.VideoGeneration ||
    type === ModelType.TTS
  )
}

function resolveNewApiRawModelType(rawType: string | undefined): ModelType | undefined {
  const normalizedRawType = normalizeProviderValue(rawType)
  switch (normalizedRawType) {
    case 'chat':
    case 'text':
    case 'llm':
      return ModelType.Chat
    case 'embedding':
    case 'embeddings':
      return ModelType.Embedding
    case 'rerank':
      return ModelType.Rerank
    case 'imagegeneration':
    case 'image-generation':
    case 'image':
      return ModelType.ImageGeneration
    case 'videogeneration':
    case 'video-generation':
    case 'video':
      return ModelType.VideoGeneration
    case 'tts':
    case 'audio-speech':
    case 'audiospeech':
      return ModelType.TTS
    default:
      return undefined
  }
}

function dedupeNewApiEndpointTypes(
  endpointTypes: readonly NewApiEndpointType[] | null | undefined
): NewApiEndpointType[] {
  const seen = new Set<NewApiEndpointType>()
  const result: NewApiEndpointType[] = []

  for (const endpointType of endpointTypes ?? []) {
    if (!isNewApiEndpointType(endpointType) || seen.has(endpointType)) {
      continue
    }
    seen.add(endpointType)
    result.push(endpointType)
  }

  return result
}

function isPureNewApiMediaEndpointRoute(
  endpointTypes: readonly NewApiEndpointType[],
  endpointType: Extract<NewApiEndpointType, 'image-generation' | 'video-generation'>
): boolean {
  return endpointTypes.length > 0 && endpointTypes.every((value) => value === endpointType)
}

export function resolveNewApiModelTypeFromMetadata(
  supportedEndpointTypes: readonly NewApiEndpointType[],
  modelId: string | undefined,
  rawTypeValue: string | undefined
): ModelType | undefined {
  const rawType = resolveNewApiRawModelType(rawTypeValue)
  if (rawType) {
    return rawType
  }

  const normalizedModelId = normalizeModelId(modelId)
  if (normalizedModelId.includes('embedding') || normalizedModelId.includes('embed')) {
    return ModelType.Embedding
  }
  if (normalizedModelId.includes('rerank')) {
    return ModelType.Rerank
  }
  if (
    normalizedModelId.startsWith('tts-') ||
    normalizedModelId.startsWith('whisper-') ||
    normalizedModelId.startsWith('audio-') ||
    normalizedModelId.includes('speech') ||
    normalizedModelId.includes('transcribe')
  ) {
    return ModelType.TTS
  }

  if (normalizedModelId.startsWith('dall-e-') || normalizedModelId.startsWith('gpt-image-')) {
    return ModelType.ImageGeneration
  }
  if (normalizedModelId.startsWith('sora-')) {
    return ModelType.VideoGeneration
  }

  if (isPureNewApiMediaEndpointRoute(supportedEndpointTypes, 'image-generation')) {
    return ModelType.ImageGeneration
  }
  if (isPureNewApiMediaEndpointRoute(supportedEndpointTypes, 'video-generation')) {
    return ModelType.VideoGeneration
  }

  return undefined
}

function resolveNewApiSelectableModelType(
  supportedEndpointTypes: readonly NewApiEndpointType[],
  modelId: string | undefined,
  options: {
    type?: ModelType
    rawType?: string
  }
): ModelType {
  return (
    options.type ??
    resolveNewApiModelTypeFromMetadata(supportedEndpointTypes, modelId, options.rawType) ??
    ModelType.Chat
  )
}

function appendMissingNewApiEndpointTypes(
  endpointTypes: readonly NewApiEndpointType[],
  additions: readonly NewApiEndpointType[]
): NewApiEndpointType[] {
  const result = [...endpointTypes]
  for (const endpointType of additions) {
    if (!result.includes(endpointType)) {
      result.push(endpointType)
    }
  }
  return result
}

export function resolveNewApiSelectableEndpointTypes(
  supportedEndpointTypes: readonly NewApiEndpointType[] | null | undefined,
  modelId: string | undefined,
  options: {
    type?: ModelType
    rawType?: string
  } = {}
): NewApiEndpointType[] | undefined {
  const normalizedEndpointTypes = dedupeNewApiEndpointTypes(supportedEndpointTypes)
  const selectableModelType = resolveNewApiSelectableModelType(normalizedEndpointTypes, modelId, {
    type: options.type,
    rawType: options.rawType
  })

  if (selectableModelType === ModelType.ImageGeneration) {
    return ['image-generation']
  }

  if (selectableModelType === ModelType.VideoGeneration) {
    return ['video-generation']
  }

  if (
    isExplicitNonChatNewApiModelType(selectableModelType) ||
    isNewApiResponsesIncompatibleModelId(modelId)
  ) {
    return [...OPENAI_COMPATIBLE_NEW_API_ENDPOINT_TYPES]
  }

  const supportedChatEndpointTypes = normalizedEndpointTypes.filter((endpointType) =>
    NEW_API_CHAT_ENDPOINT_TYPES.includes(endpointType)
  )
  return appendMissingNewApiEndpointTypes(supportedChatEndpointTypes, NEW_API_CHAT_ENDPOINT_TYPES)
}

function hasNewApiRouteHints(route: NewApiRouteMeta | null | undefined): boolean {
  return (
    Boolean(route?.endpointType && isNewApiEndpointType(route.endpointType)) ||
    Boolean(route?.supportedEndpointTypes?.some(isNewApiEndpointType))
  )
}

export const hasNativeToolCapability = (
  route: Pick<NewApiRouteMeta, 'endpointType' | 'supportedEndpointTypes'> | null | undefined,
  functionCall?: boolean | null
): boolean => Boolean(functionCall) || hasNewApiRouteHints(route)

function hasZenmuxAnthropicRoute(providerId: string, modelId?: string): boolean {
  return (
    normalizeProviderValue(providerId) === 'zenmux' &&
    normalizeModelId(modelId).startsWith('anthropic/')
  )
}

export function isClaudeFamilyModelId(modelId: string | undefined): boolean {
  return normalizeModelId(modelId).includes('claude')
}

export function isGeminiFamilyModelId(modelId: string | undefined): boolean {
  return normalizeModelId(modelId).includes('gemini')
}

export function isDeepSeekSeriesModelId(modelId: string | undefined): boolean {
  return normalizeModelId(modelId).includes('deepseek')
}

function hasAnthropicRouteHint(
  route: Pick<NewApiRouteMeta, 'ownedBy' | 'capabilityProviderId'> | null | undefined,
  modelId?: string
): boolean {
  const ownedBy = normalizeRouteHintValue(route?.ownedBy)
  const capabilityProviderId = normalizeRouteHintValue(route?.capabilityProviderId)
  return (
    isClaudeFamilyModelId(modelId) ||
    ownedBy.includes('claude') ||
    ownedBy.includes('anthropic') ||
    capabilityProviderId.includes('anthropic')
  )
}

function hasGeminiRouteHint(
  route: Pick<NewApiRouteMeta, 'ownedBy' | 'capabilityProviderId'> | null | undefined,
  modelId?: string
): boolean {
  const ownedBy = normalizeRouteHintValue(route?.ownedBy)
  const capabilityProviderId = normalizeRouteHintValue(route?.capabilityProviderId)
  return (
    isGeminiFamilyModelId(modelId) ||
    ownedBy.includes('gemini') ||
    ownedBy.includes('google') ||
    capabilityProviderId.includes('gemini') ||
    capabilityProviderId.includes('google')
  )
}

export function inferNewApiSpecialEndpointTypeFromRoute(
  route: Pick<NewApiRouteMeta, 'ownedBy' | 'capabilityProviderId'> | null | undefined,
  modelId?: string
): NewApiSpecialEndpointType | undefined {
  if (hasAnthropicRouteHint(route, modelId)) {
    return 'anthropic'
  }

  if (hasGeminiRouteHint(route, modelId)) {
    return 'gemini'
  }

  return undefined
}

export const resolveNewApiCapabilityProviderId = (
  endpointType: NewApiEndpointType
): NewApiCapabilityProviderId => {
  switch (endpointType) {
    case 'anthropic':
      return 'anthropic'
    case 'gemini':
      return 'gemini'
    case 'openai':
    case 'openai-response':
    case 'image-generation':
    case 'video-generation':
    default:
      return 'openai'
  }
}

export const shouldUseAnthropicClaudeRouteFromSupportedEndpoints = (
  route: NewApiRouteMeta | null | undefined,
  modelId?: string
): boolean => {
  if (route?.endpointType && isNewApiEndpointType(route.endpointType)) {
    return false
  }

  const supportedEndpointTypes = route?.supportedEndpointTypes?.filter(isNewApiEndpointType) ?? []
  if (!supportedEndpointTypes.includes('anthropic')) {
    return false
  }

  if (!isClaudeFamilyModelId(modelId)) {
    return false
  }

  return supportedEndpointTypes.some(
    (endpointType) => endpointType !== 'anthropic' && endpointType !== 'image-generation'
  )
}

export const resolveNewApiEndpointTypeFromRoute = (
  route: NewApiRouteMeta | null | undefined,
  modelId?: string
): NewApiEndpointType => {
  if (route?.endpointType && isNewApiEndpointType(route.endpointType)) {
    return route.endpointType
  }

  const supportedEndpointTypes = route?.supportedEndpointTypes?.filter(isNewApiEndpointType) ?? []
  const specialEndpointType = inferNewApiSpecialEndpointTypeFromRoute(route, modelId)
  if (
    route?.type === ModelType.ImageGeneration &&
    supportedEndpointTypes.includes('image-generation')
  ) {
    return 'image-generation'
  }

  if (
    route?.type === ModelType.VideoGeneration &&
    supportedEndpointTypes.includes('video-generation')
  ) {
    return 'video-generation'
  }

  if (shouldUseAnthropicClaudeRouteFromSupportedEndpoints(route, modelId)) {
    return 'anthropic'
  }

  if (specialEndpointType && supportedEndpointTypes.includes(specialEndpointType)) {
    return specialEndpointType
  }

  if (supportedEndpointTypes.length > 0) {
    return supportedEndpointTypes[0]
  }

  if (route?.type === ModelType.ImageGeneration) {
    return 'image-generation'
  }

  if (route?.type === ModelType.VideoGeneration) {
    return 'video-generation'
  }

  if (specialEndpointType) {
    return specialEndpointType
  }

  return 'openai'
}

export const resolveProviderCapabilityProviderId = (
  providerId: string,
  route: NewApiRouteMeta | null | undefined,
  modelId?: string
): string => {
  if (hasZenmuxAnthropicRoute(providerId, modelId)) {
    return 'anthropic'
  }

  if (!hasNewApiRouteHints(route)) {
    return providerId
  }

  return resolveNewApiCapabilityProviderId(resolveNewApiEndpointTypeFromRoute(route, modelId))
}

export const isChatSelectableModelType = (type: ModelType | undefined): boolean =>
  type === undefined ||
  type === ModelType.Chat ||
  type === ModelType.ImageGeneration ||
  type === ModelType.VideoGeneration ||
  type === ModelType.TTS
