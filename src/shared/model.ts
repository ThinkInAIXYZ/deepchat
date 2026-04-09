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

export const isNewApiEndpointType = (value: unknown): value is NewApiEndpointType =>
  typeof value === 'string' && NEW_API_ENDPOINT_TYPES.includes(value as NewApiEndpointType)

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

export const isChatSelectableModelType = (type: ModelType | undefined): boolean =>
  type === undefined || type === ModelType.Chat || type === ModelType.ImageGeneration
