import {
  ModelType,
  inferNewApiSpecialEndpointTypeFromRoute,
  isNewApiEndpointType,
  type NewApiEndpointType
} from '@shared/model'
import { isTtsModelId } from '@shared/ttsSettings'
import type { MODEL_META } from '@shared/types/provider'
import { isApimartResponsesRoute } from '../capabilityIdentity'
import { AiSdkProvider } from './aiSdkProvider'

const APIMART_DEFAULT_BASE_URL = 'https://api.apimart.ai/v1'

type ApimartMediaRoute = {
  endpoint: string
  parameterNames?: Set<string>
}

type ApimartModelRoute = {
  endpointType: NewApiEndpointType
  supportedEndpointTypes: NewApiEndpointType[]
}

type ApimartModelRecord = Record<string, unknown> & {
  id: string
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized || undefined
}

const toPositiveFiniteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined

function extractModelRecords(payload: unknown): ApimartModelRecord[] {
  const root = asRecord(payload)
  if (
    !root ||
    !Array.isArray(root.data) ||
    (root.success !== undefined && root.success !== true) ||
    (root.object !== undefined && root.object !== 'list')
  ) {
    throw new Error('Invalid APIMart model catalog response')
  }

  return root.data.filter(
    (record): record is ApimartModelRecord =>
      Boolean(asRecord(record)) && typeof asRecord(record)?.id === 'string'
  )
}

function getParameterNames(
  parameters: Record<string, unknown> | undefined
): Set<string> | undefined {
  const properties = asRecord(asRecord(parameters?.input_schema)?.properties)
  return properties ? new Set(Object.keys(properties)) : undefined
}

function resolveModelCategory(record: ApimartModelRecord): string {
  return normalizeString(record.category)?.toLowerCase() ?? 'unknown'
}

function resolveModelType(record: ApimartModelRecord): ModelType {
  const modelId = record.id.trim().toLowerCase()
  const category = resolveModelCategory(record)
  const parameters = asRecord(record.parameters)
  const operation = normalizeString(parameters?.operation)?.toLowerCase()
  const endpoint = normalizeString(parameters?.endpoint)?.toLowerCase()
  const capabilityTags = Array.isArray(record.capability_tags)
    ? record.capability_tags
        .filter((tag): tag is string => typeof tag === 'string')
        .map((tag) => tag.trim().toLowerCase())
    : []

  if (
    category === 'image' ||
    operation === 'image_generation' ||
    endpoint?.endsWith('/images/generations')
  ) {
    return ModelType.ImageGeneration
  }

  if (
    category === 'video' ||
    operation === 'video_generation' ||
    endpoint?.endsWith('/videos/generations')
  ) {
    return ModelType.VideoGeneration
  }

  if (capabilityTags.includes('embedding') || modelId.includes('embedding')) {
    return ModelType.Embedding
  }

  if (endpoint?.endsWith('/audio/speech') || isTtsModelId(modelId)) {
    return ModelType.TTS
  }

  return ModelType.Chat
}

function isSupportedAudioModel(record: ApimartModelRecord, type: ModelType): boolean {
  if (resolveModelCategory(record) !== 'audio') {
    return true
  }

  const modelId = record.id.trim().toLowerCase()
  return type === ModelType.TTS || modelId.includes('whisper') || modelId.includes('transcri')
}

function resolveDocumentedEndpointType(record: ApimartModelRecord): NewApiEndpointType | undefined {
  const endpoint = normalizeString(asRecord(record.parameters)?.endpoint)?.toLowerCase()
  if (!endpoint) {
    return undefined
  }

  if (endpoint.endsWith('/responses')) return 'openai-response'
  if (endpoint.endsWith('/chat/completions')) return 'openai'
  if (endpoint.endsWith('/messages')) return 'anthropic'
  if (endpoint.includes('/v1beta') && endpoint.includes('/models/')) return 'gemini'
  return undefined
}

function resolveModelRoute(record: ApimartModelRecord, type: ModelType): ApimartModelRoute {
  if (type === ModelType.ImageGeneration) {
    return {
      endpointType: 'image-generation',
      supportedEndpointTypes: ['image-generation']
    }
  }
  if (type === ModelType.VideoGeneration) {
    return {
      endpointType: 'video-generation',
      supportedEndpointTypes: ['video-generation']
    }
  }
  if (type !== ModelType.Chat) {
    return { endpointType: 'openai', supportedEndpointTypes: ['openai'] }
  }

  const supportedEndpointTypes = Array.isArray(record.supported_endpoint_types)
    ? [
        ...new Set(
          record.supported_endpoint_types.filter(
            (endpointType): endpointType is NewApiEndpointType =>
              isNewApiEndpointType(endpointType) &&
              endpointType !== 'image-generation' &&
              endpointType !== 'video-generation'
          )
        )
      ]
    : []
  const documentedEndpointType = resolveDocumentedEndpointType(record)
  if (documentedEndpointType) {
    return {
      endpointType: documentedEndpointType,
      supportedEndpointTypes: [
        documentedEndpointType,
        ...supportedEndpointTypes.filter((endpointType) => endpointType !== documentedEndpointType)
      ]
    }
  }

  const nativeEndpointType = inferNewApiSpecialEndpointTypeFromRoute(
    { ownedBy: normalizeString(record.owned_by) },
    record.id
  )
  if (nativeEndpointType && supportedEndpointTypes.includes(nativeEndpointType)) {
    return { endpointType: nativeEndpointType, supportedEndpointTypes }
  }
  if (
    supportedEndpointTypes.includes('openai-response') ||
    (supportedEndpointTypes.includes('openai') && isApimartResponsesRoute('apimart', record.id))
  ) {
    return { endpointType: 'openai-response', supportedEndpointTypes }
  }

  return {
    endpointType: supportedEndpointTypes[0] ?? 'openai',
    supportedEndpointTypes: supportedEndpointTypes.length > 0 ? supportedEndpointTypes : ['openai']
  }
}

function resolveGroup(record: ApimartModelRecord): string {
  const category = resolveModelCategory(record)
  return category === 'unknown'
    ? 'APIMart'
    : `${category.charAt(0).toUpperCase()}${category.slice(1)}`
}

export class ApimartProvider extends AiSdkProvider {
  private getBaseUrl(): string {
    const normalized = (this.provider.baseUrl || APIMART_DEFAULT_BASE_URL)
      .trim()
      .replace(/\/+$/, '')
    if (!normalized) {
      return APIMART_DEFAULT_BASE_URL
    }
    return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`
  }

  private resolveMediaRoute(
    record: ApimartModelRecord,
    type: ModelType
  ): ApimartMediaRoute | undefined {
    if (type !== ModelType.ImageGeneration && type !== ModelType.VideoGeneration) {
      return undefined
    }

    const kind = type === ModelType.ImageGeneration ? 'image' : 'video'
    const defaultEndpoint = kind === 'image' ? '/v1/images/generations' : '/v1/videos/generations'
    const parameters = asRecord(record.parameters)
    const documentedEndpoint = normalizeString(parameters?.endpoint)
    const expectedSuffix = `/${kind === 'image' ? 'images' : 'videos'}/generations`
    const endpoint =
      documentedEndpoint?.startsWith('/') && documentedEndpoint.endsWith(expectedSuffix)
        ? documentedEndpoint
        : defaultEndpoint

    return {
      endpoint,
      parameterNames: getParameterNames(parameters)
    }
  }

  protected override async fetchProviderModels(): Promise<MODEL_META[]> {
    const payload = await this.requestProviderJson<unknown>(
      `${this.getBaseUrl()}/models?expand=parameters`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json'
        }
      },
      this.getModelFetchTimeout()
    )
    const models = extractModelRecords(payload).flatMap((record): MODEL_META[] => {
      const id = record.id.trim()
      if (!id) {
        return []
      }

      const type = resolveModelType(record)
      if (!isSupportedAudioModel(record, type) || id.toLowerCase().includes('moderation')) {
        return []
      }

      const mediaRoute = this.resolveMediaRoute(record, type)

      const { endpointType, supportedEndpointTypes } = resolveModelRoute(record, type)
      const capabilityTags = Array.isArray(record.capability_tags)
        ? record.capability_tags.filter((tag): tag is string => typeof tag === 'string')
        : []
      const ownedBy = normalizeString(record.owned_by)
      const contextLength =
        toPositiveFiniteNumber(record.context_length) ??
        toPositiveFiniteNumber(record.input_token_limit)
      const maxTokens =
        toPositiveFiniteNumber(record.max_tokens) ??
        toPositiveFiniteNumber(record.max_output_tokens) ??
        toPositiveFiniteNumber(record.output_token_limit)

      return [
        {
          id,
          name: normalizeString(record.name) ?? id,
          group: resolveGroup(record),
          providerId: this.provider.id,
          isCustom: false,
          type,
          endpointType,
          supportedEndpointTypes,
          ownedBy,
          ...(mediaRoute
            ? {
                mediaRoute: {
                  endpoint: mediaRoute.endpoint,
                  ...(mediaRoute.parameterNames
                    ? { parameterNames: [...mediaRoute.parameterNames] }
                    : {})
                }
              }
            : {}),
          ...(capabilityTags.some((tag) => ['vision', 'omni'].includes(tag.toLowerCase()))
            ? { vision: true }
            : {}),
          ...(contextLength !== undefined ? { contextLength } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {})
        }
      ]
    })

    return models
  }
}
