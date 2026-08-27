import { cacheImage, fetchRemoteFile } from '@/platform/imageCache'
import {
  normalizeImageGenerationOptions,
  type ImageGenerationOptions
} from '@shared/imageGenerationSettings'
import {
  ModelType,
  inferNewApiSpecialEndpointTypeFromRoute,
  isNewApiEndpointType,
  type NewApiEndpointType
} from '@shared/model'
import { isTtsModelId } from '@shared/ttsSettings'
import type { ChatMessage } from '@shared/types/core/chat-message'
import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { MCPToolDefinition } from '@shared/types/mcp'
import type { MODEL_META, ModelConfig, ProviderStreamOptions } from '@shared/types/provider'
import {
  normalizeVideoGenerationOptions,
  type VideoGenerationOptions,
  type VideoGenerationReference
} from '@shared/videoGenerationSettings'
import { isApimartResponsesRoute } from '../capabilityIdentity'
import { AiSdkProvider } from './aiSdkProvider'

const APIMART_DEFAULT_BASE_URL = 'https://api.apimart.ai/v1'
const APIMART_POLL_INTERVAL_MS = 3000
const APIMART_TASK_TIMEOUT_MS = 15 * 60 * 1000
const APIMART_VIDEO_DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000
const APIMART_VIDEO_DOWNLOAD_MAX_BYTES = 256 * 1024 * 1024

type ApimartMediaKind = 'image' | 'video'

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

function normalizePromptValue(value: ChatMessage['content']): string {
  if (typeof value === 'string') {
    return value
  }

  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .filter(
      (part): part is Extract<(typeof value)[number], { type: 'text' }> => part.type === 'text'
    )
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)
    .join('\n')
}

function extractPrompt(messages: ChatMessage[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .map((message) => normalizePromptValue(message.content))
    .filter((content) => content.trim().length > 0)
    .join('\n\n')
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b > 0) {
    const remainder = a % b
    a = b
    b = remainder
  }
  return a
}

function resolveAspectRatio(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  if (!normalized) {
    return undefined
  }
  if (/^\d+:\d+$/.test(normalized)) {
    return normalized
  }

  const match = normalized.match(/^(\d+)x(\d+)$/i)
  if (!match) {
    return undefined
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  const divisor = greatestCommonDivisor(width, height)
  return `${width / divisor}:${height / divisor}`
}

function normalizeReference(reference: VideoGenerationReference): string | undefined {
  const url = normalizeString(reference.url)
  if (url) {
    return url
  }

  const data = normalizeString(reference.data)
  if (!data) {
    return undefined
  }
  if (data.startsWith('data:')) {
    return data
  }

  const mimeType =
    normalizeString(reference.mimeType) ??
    (reference.type === 'image'
      ? 'image/png'
      : reference.type === 'audio'
        ? 'audio/mpeg'
        : 'video/mp4')
  return `data:${mimeType};base64,${data}`
}

function extractTaskRecord(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload) ?? {}
  const data = root.data
  if (Array.isArray(data)) {
    return asRecord(data[0]) ?? root
  }
  return asRecord(data) ?? root
}

function extractTaskId(payload: unknown): string | undefined {
  const task = extractTaskRecord(payload)
  return normalizeString(task.task_id) ?? normalizeString(task.id)
}

function extractTaskError(task: Record<string, unknown>, fallback: string): string {
  const error = task.error
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  const errorRecord = asRecord(error)
  return normalizeString(errorRecord?.message) ?? normalizeString(task.message) ?? fallback
}

function collectUrls(value: unknown): string[] {
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized ? [normalized] : []
  }

  if (Array.isArray(value)) {
    return value.flatMap(collectUrls)
  }

  const record = asRecord(value)
  if (!record) {
    return []
  }

  return ['url', 'urls', 'uri', 'image_url', 'video_url'].flatMap((key) => collectUrls(record[key]))
}

function extractMediaUrls(task: Record<string, unknown>, kind: ApimartMediaKind): string[] {
  const result = asRecord(task.result)
  const values = result
    ? collectUrls(result[kind === 'image' ? 'images' : 'videos']).concat(
        collectUrls(result[kind === 'image' ? 'image' : 'video']),
        collectUrls(result.url)
      )
    : []
  return [...new Set(values)]
}

function inferMediaMimeType(url: string, kind: ApimartMediaKind): string {
  let pathname = url.toLowerCase()
  try {
    pathname = new URL(url).pathname.toLowerCase()
  } catch {
    // Keep the raw value for non-URL test fixtures.
  }

  if (kind === 'video') {
    if (pathname.endsWith('.webm')) return 'video/webm'
    if (pathname.endsWith('.mov')) return 'video/quicktime'
    return 'video/mp4'
  }

  if (pathname.endsWith('.webp')) return 'image/webp'
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg'
  if (pathname.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function createAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
  if (signal.aborted) {
    return Promise.reject(createAbortError(signal))
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', onAbort)
      reject(createAbortError(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export class ApimartProvider extends AiSdkProvider {
  private readonly mediaRoutes = new Map<string, ApimartMediaRoute>()

  private getBaseUrl(): string {
    const normalized = (this.provider.baseUrl || APIMART_DEFAULT_BASE_URL)
      .trim()
      .replace(/\/+$/, '')
    if (!normalized) {
      return APIMART_DEFAULT_BASE_URL
    }
    return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`
  }

  private buildApiUrl(endpoint: string): string {
    const baseUrl = this.getBaseUrl()
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    if (normalizedEndpoint === '/v1' || normalizedEndpoint.startsWith('/v1/')) {
      return `${baseUrl.replace(/\/v1$/i, '')}${normalizedEndpoint}`
    }
    return `${baseUrl}${normalizedEndpoint}`
  }

  private getMediaRoute(modelId: string, kind: ApimartMediaKind): ApimartMediaRoute {
    return (
      this.mediaRoutes.get(modelId) ?? {
        endpoint: kind === 'image' ? '/v1/images/generations' : '/v1/videos/generations'
      }
    )
  }

  private canSendParameter(route: ApimartMediaRoute, name: string): boolean {
    return route.parameterNames?.has(name) === true
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
    const nextMediaRoutes = new Map<string, ApimartMediaRoute>()
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
      if (mediaRoute) {
        nextMediaRoutes.set(id, mediaRoute)
      }

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
          ...(capabilityTags.some((tag) => ['vision', 'omni'].includes(tag.toLowerCase()))
            ? { vision: true }
            : {}),
          ...(contextLength !== undefined ? { contextLength } : {}),
          ...(maxTokens !== undefined ? { maxTokens } : {})
        }
      ]
    })

    this.mediaRoutes.clear()
    for (const [modelId, route] of nextMediaRoutes) {
      this.mediaRoutes.set(modelId, route)
    }
    return models
  }

  private buildImageRequestBody(
    modelId: string,
    prompt: string,
    route: ApimartMediaRoute,
    options: ImageGenerationOptions | undefined
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: modelId,
      prompt
    }
    const normalizedOptions = normalizeImageGenerationOptions(options)
    if (!normalizedOptions) {
      return body
    }

    const size = resolveAspectRatio(normalizedOptions.size)
    if (size && this.canSendParameter(route, 'size')) body.size = size
    if (normalizedOptions.quality && this.canSendParameter(route, 'quality')) {
      body.quality = normalizedOptions.quality
    }
    if (normalizedOptions.outputFormat && this.canSendParameter(route, 'output_format')) {
      body.output_format = normalizedOptions.outputFormat
    }
    if (
      normalizedOptions.outputCompression !== undefined &&
      this.canSendParameter(route, 'output_compression')
    ) {
      body.output_compression = normalizedOptions.outputCompression
    }
    if (normalizedOptions.background && this.canSendParameter(route, 'background')) {
      body.background = normalizedOptions.background
    }
    if (normalizedOptions.moderation && this.canSendParameter(route, 'moderation')) {
      body.moderation = normalizedOptions.moderation
    }
    return body
  }

  private assignAspectRatio(
    body: Record<string, unknown>,
    route: ApimartMediaRoute,
    options: VideoGenerationOptions
  ): void {
    const ratio = normalizeString(options.ratio) ?? resolveAspectRatio(options.size)
    if (!ratio) {
      if (options.size && this.canSendParameter(route, 'size')) {
        body.size = options.size
      }
      return
    }

    const parameterName = ['aspect_ratio', 'ratio', 'size'].find((name) =>
      this.canSendParameter(route, name)
    )
    if (parameterName) {
      body[parameterName] = ratio
    }
  }

  private assignVideoReferences(
    body: Record<string, unknown>,
    route: ApimartMediaRoute,
    options: VideoGenerationOptions
  ): void {
    const references = options.references ?? []
    const imageUrls = references
      .filter((reference) => reference.type === 'image')
      .flatMap((reference) => normalizeReference(reference) ?? [])
    const videoUrls = references
      .filter((reference) => reference.type === 'video')
      .flatMap((reference) => normalizeReference(reference) ?? [])
    const audioUrls = references
      .filter((reference) => reference.type === 'audio')
      .flatMap((reference) => normalizeReference(reference) ?? [])

    if (typeof options.inputReference === 'string' && options.inputReference.trim()) {
      imageUrls.unshift(options.inputReference.trim())
    } else if (options.inputReference && typeof options.inputReference === 'object') {
      const data = normalizeString(options.inputReference.data)
      if (data) {
        imageUrls.unshift(
          data.startsWith('data:')
            ? data
            : `data:${normalizeString(options.inputReference.mimeType) ?? 'image/png'};base64,${data}`
        )
      }
    }

    if (imageUrls.length > 0 && this.canSendParameter(route, 'image_urls')) {
      body.image_urls = [...new Set(imageUrls)]
    }
    if (videoUrls.length > 0 && this.canSendParameter(route, 'video_urls')) {
      body.video_urls = [...new Set(videoUrls)]
    }
    if (audioUrls.length > 0 && this.canSendParameter(route, 'audio_urls')) {
      body.audio_urls = [...new Set(audioUrls)]
    }
  }

  private buildVideoRequestBody(
    modelId: string,
    prompt: string,
    route: ApimartMediaRoute,
    options: VideoGenerationOptions | undefined
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: modelId,
      prompt
    }
    const normalizedOptions = normalizeVideoGenerationOptions(options)
    if (!normalizedOptions) {
      return body
    }

    const parsedSeconds = normalizeString(normalizedOptions.seconds)
      ? Number.parseInt(normalizedOptions.seconds as string, 10)
      : undefined
    const duration =
      typeof normalizedOptions.duration === 'number'
        ? normalizedOptions.duration
        : Number.isFinite(parsedSeconds)
          ? parsedSeconds
          : undefined
    if (duration !== undefined) {
      if (this.canSendParameter(route, 'duration')) {
        body.duration = duration
      } else if (this.canSendParameter(route, 'seconds')) {
        body.seconds = String(duration)
      }
    }

    this.assignAspectRatio(body, route, normalizedOptions)
    if (normalizedOptions.resolution && this.canSendParameter(route, 'resolution')) {
      body.resolution = normalizedOptions.resolution
    }
    if (normalizedOptions.watermark !== undefined && this.canSendParameter(route, 'watermark')) {
      body.watermark = normalizedOptions.watermark
    }
    if (
      normalizedOptions.generateAudio !== undefined &&
      this.canSendParameter(route, 'generate_audio')
    ) {
      body.generate_audio = normalizedOptions.generateAudio
    }
    this.assignVideoReferences(body, route, normalizedOptions)
    return body
  }

  private async waitForTask(
    taskId: string,
    signal?: AbortSignal,
    timeoutMs = APIMART_TASK_TIMEOUT_MS
  ): Promise<Record<string, unknown>> {
    const taskUrl = `${this.getBaseUrl()}/tasks/${encodeURIComponent(taskId)}?language=en`
    const deadline = Date.now() + timeoutMs
    while (true) {
      if (Date.now() >= deadline) {
        throw new Error(`APIMart task polling timed out after ${timeoutMs}ms`)
      }
      const payload = await this.requestProviderJson<unknown>(
        taskUrl,
        { method: 'GET' },
        { signal }
      )
      const task = extractTaskRecord(payload)
      const status = normalizeString(task.status)?.toLowerCase()
      const hasResult = Boolean(asRecord(task.result))

      if (status === 'completed' || status === 'succeeded' || (status === 'success' && hasResult)) {
        return task
      }
      if (['failed', 'error', 'cancelled', 'canceled'].includes(status ?? '')) {
        throw new Error(extractTaskError(task, `APIMart task ${status ?? 'failed'}`))
      }

      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) {
        throw new Error(`APIMart task polling timed out after ${timeoutMs}ms`)
      }
      await delayWithAbort(Math.min(APIMART_POLL_INTERVAL_MS, remainingMs), signal)
    }
  }

  private async downloadVideo(
    url: string,
    signal?: AbortSignal
  ): Promise<{ data: string; mimeType: string }> {
    const response = await fetchRemoteFile(url, {
      signal,
      allowPrivateNetwork: false,
      maxBytes: APIMART_VIDEO_DOWNLOAD_MAX_BYTES,
      timeoutMs: APIMART_VIDEO_DOWNLOAD_TIMEOUT_MS
    })
    if (!response.ok) {
      throw new Error(
        `APIMart video download failed (${response.status}): ${response.data.toString('utf8')}`
      )
    }

    const mimeType = response.mimeType || inferMediaMimeType(url, 'video')
    const data = response.data.toString('base64')
    return {
      data: `data:${mimeType};base64,${data}`,
      mimeType
    }
  }

  private async *generateMedia(
    kind: ApimartMediaKind,
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    callerSignal?: AbortSignal
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const prompt = extractPrompt(messages)
    if (!prompt.trim()) {
      throw new Error(`${kind === 'image' ? 'Image' : 'Video'} generation prompt is required`)
    }

    const route = this.getMediaRoute(modelId, kind)
    const endpoint = this.buildApiUrl(route.endpoint)
    const body =
      kind === 'image'
        ? this.buildImageRequestBody(modelId, prompt, route, modelConfig.imageGeneration)
        : this.buildVideoRequestBody(modelId, prompt, route, modelConfig.videoGeneration)
    const timeout = this.resolveModelRequestTimeout(modelConfig) ?? APIMART_TASK_TIMEOUT_MS
    const { signal, dispose } = this.createModelRequestSignal({ timeout }, callerSignal)

    try {
      signal?.throwIfAborted()
      await this.emitRequestTrace(modelConfig, {
        endpoint,
        headers: {
          ...this.defaultHeaders,
          'Content-Type': 'application/json'
        },
        body
      })
      const submission = await this.requestProviderJson<unknown>(
        endpoint,
        {
          method: 'POST',
          body: JSON.stringify(body)
        },
        { signal }
      )
      const taskId = extractTaskId(submission)
      if (!taskId) {
        throw new Error(`APIMart ${kind} generation response missing task_id`)
      }

      const task = await this.waitForTask(taskId, signal)
      const urls = extractMediaUrls(task, kind)
      if (urls.length === 0) {
        throw new Error(`APIMart ${kind} generation completed without output`)
      }

      for (const url of urls) {
        if (kind === 'image') {
          const mimeType = inferMediaMimeType(url, kind)
          const data = await cacheImage(url, { signal, allowPrivateNetwork: false })
          if (!data.startsWith('imgcache://')) {
            throw new Error('APIMart image output could not be cached safely')
          }
          yield {
            type: 'image_data',
            image_data: { data, mimeType }
          }
        } else {
          const video = await this.downloadVideo(url, signal)
          yield {
            type: 'image_data',
            image_data: video
          }
        }
      }

      yield {
        type: 'stop',
        stop_reason: 'complete'
      }
    } finally {
      dispose()
    }
  }

  public override async *coreStream(
    messages: ChatMessage[],
    modelId: string,
    modelConfig: ModelConfig,
    temperature: number,
    maxTokens: number,
    tools: MCPToolDefinition[],
    options?: ProviderStreamOptions
  ): AsyncGenerator<LLMCoreStreamEvent> {
    const decision = this.resolveRouteDecision(modelId, modelConfig)
    const resolvedModelConfig = this.getModelConfigForDecision(modelId, decision, modelConfig)

    if (decision.endpointType === 'image-generation') {
      yield* this.generateMedia('image', messages, modelId, resolvedModelConfig, options?.signal)
      return
    }

    if (decision.endpointType === 'video-generation') {
      yield* this.generateMedia('video', messages, modelId, resolvedModelConfig, options?.signal)
      return
    }

    yield* super.coreStream(
      messages,
      modelId,
      resolvedModelConfig,
      temperature,
      maxTokens,
      tools,
      options
    )
  }
}
