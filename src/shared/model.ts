// src/shared/presenter.ts
// Implement enum and runtime exports to avoid Vite errors

export enum ModelType {
  Chat = 'chat',
  Embedding = 'embedding',
  Rerank = 'rerank',
  ImageGeneration = 'imageGeneration'
}

export enum ApiEndpointType {
  Chat = 'chat',
  Image = 'image',
  Video = 'video'
}

export const NEW_API_ENDPOINT_TYPES = [
  'openai',
  'openai-response',
  'anthropic',
  'gemini',
  'image-generation'
] as const

export type NewApiEndpointType = (typeof NEW_API_ENDPOINT_TYPES)[number]

export type NewApiCapabilityProviderId = 'openai' | 'anthropic' | 'gemini'

export type NewApiRouteMeta = {
  endpointType?: NewApiEndpointType
  supportedEndpointTypes?: NewApiEndpointType[]
  type?: ModelType
}

export const isNewApiEndpointType = (value: unknown): value is NewApiEndpointType =>
  typeof value === 'string' && NEW_API_ENDPOINT_TYPES.includes(value as NewApiEndpointType)

function normalizeModelId(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function normalizeUnprefixedModelId(value: string | undefined): string {
  const normalizedModelId = normalizeModelId(value)
  return normalizedModelId.includes('/')
    ? normalizedModelId.slice(normalizedModelId.lastIndexOf('/') + 1)
    : normalizedModelId
}

function hasNewApiRouteHints(route: NewApiRouteMeta | null | undefined): boolean {
  return (
    Boolean(route?.endpointType && isNewApiEndpointType(route.endpointType)) ||
    Boolean(route?.supportedEndpointTypes?.some(isNewApiEndpointType))
  )
}

export function isClaudeFamilyModelId(modelId: string | undefined): boolean {
  return normalizeModelId(modelId).includes('claude')
}

export function isClaudeOpus47FamilyModelId(modelId: string | undefined): boolean {
  const normalizedModelId = normalizeUnprefixedModelId(modelId)
  return normalizedModelId === 'claude-opus-4-7' || normalizedModelId === 'claude-opus-4-7-think'
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
    default:
      return 'openai'
  }
}

export const resolveNewApiEndpointTypeFromRoute = (
  route: NewApiRouteMeta | null | undefined,
  modelId?: string
): NewApiEndpointType => {
  if (route?.endpointType && isNewApiEndpointType(route.endpointType)) {
    return route.endpointType
  }

  const supportedEndpointTypes = route?.supportedEndpointTypes?.filter(isNewApiEndpointType) ?? []
  if (
    route?.type === ModelType.ImageGeneration &&
    supportedEndpointTypes.includes('image-generation')
  ) {
    return 'image-generation'
  }

  if (
    isClaudeFamilyModelId(modelId) &&
    supportedEndpointTypes.includes('anthropic') &&
    supportedEndpointTypes.some(
      (endpointType) => endpointType !== 'anthropic' && endpointType !== 'image-generation'
    )
  ) {
    return 'anthropic'
  }

  if (supportedEndpointTypes.length > 0) {
    return supportedEndpointTypes[0]
  }

  if (route?.type === ModelType.ImageGeneration) {
    return 'image-generation'
  }

  return 'openai'
}

export const resolveProviderCapabilityProviderId = (
  providerId: string,
  route: NewApiRouteMeta | null | undefined,
  modelId?: string
): string => {
  if (!hasNewApiRouteHints(route)) {
    return providerId
  }

  return resolveNewApiCapabilityProviderId(resolveNewApiEndpointTypeFromRoute(route, modelId))
}

export const isChatSelectableModelType = (type: ModelType | undefined): boolean =>
  type === undefined || type === ModelType.Chat || type === ModelType.ImageGeneration
