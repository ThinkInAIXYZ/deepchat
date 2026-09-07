import {
  MODEL_INVOKE_MAX_OUTPUT_CHARACTERS,
  MediaGenerationEventSchema,
  ModelInvokeEventSchema,
  ModelInvokeProviderFailureSchema,
  PublicProviderSchema,
  imagesGenerateRoute,
  modelsInvokeRoute,
  providersListPublicRoute,
  speechGenerateRoute,
  videosGenerateRoute,
  type ImageGenerationInput,
  type ImageGenerationOutput,
  type ArtifactMetadata,
  type MediaGenerationEvent,
  type ModelInvokeEvent,
  type ModelInvokeInput,
  type ModelInvokeOutput,
  type PublicProvider,
  type SpeechGenerationInput,
  type SpeechGenerationOutput,
  type VideoGenerationInput,
  type VideoGenerationOutput
} from '@shared/contracts/routes'
import type { JsonValue } from '@shared/contracts/json'
import { ApiEndpointType, ModelType } from '@shared/model'
import type { LLMCoreStreamEvent, ProviderRoundStopReason } from '@shared/types/core/llm-events'
import type { ModelConfig } from '@shared/types/provider'
import { isVideoGenerationModelConfig } from '@shared/videoGenerationSettings'
import { isTtsModelConfig, isTtsModelId } from '@shared/ttsSettings'
import type { ProviderSettingsPort } from '@/provider/settings'
import type { ProviderRuntime } from '@/provider'
import { extractProviderFailureMetadata } from '@/provider/providerFailure'
import {
  createRouteMap,
  type CliRouteCaller,
  type DeepchatRouteMap,
  type RouteCaller
} from '@/routes/routeRegistry'
import { CliRequestError } from './errors'
import { resolveGeneratedMedia, type GeneratedMediaKind } from './mediaOutput'
import { artifactExtensionForMimeType, type ArtifactSpool } from './artifactSpool'
import { toPublicProviderSummary } from './providerModelAdminRoutes'

const MAX_STREAM_DELTA_CHARACTERS = 1024 * 1024
const MAX_MODEL_STREAM_EVENTS = 10_000
const MAX_PUBLIC_PROVIDERS = 1_000
const MAX_PUBLIC_MODELS = 10_000

type ComputeEmitter = (event: string, data: JsonValue) => Promise<void>

type ComputeProviderSettings = Pick<
  ProviderSettingsPort,
  | 'getProviders'
  | 'getProviderById'
  | 'getProviderModels'
  | 'getCustomModels'
  | 'getBatchModelStatus'
  | 'getModelStatus'
  | 'isKnownModel'
  | 'getModelConfig'
>

type ComputeProviderRuntime = Pick<
  ProviderRuntime,
  | 'executeWithRateLimit'
  | 'streamChat'
  | 'generateImageStandalone'
  | 'generateVideoStandalone'
  | 'generateSpeechStandalone'
>

export type CliComputeServiceOptions = Readonly<{
  providerSettings: ComputeProviderSettings
  providerRuntime: ComputeProviderRuntime
  artifactSpool?: ArtifactSpool
  mediaCacheDirectory?: string
  now?: () => number
  log?: Pick<Console, 'warn'>
}>

function requireCliCaller(caller: RouteCaller): CliRouteCaller {
  if (caller.kind !== 'cli') {
    throw new CliRequestError('permission_denied', 'Compute routes require a CLI caller', {
      httpStatus: 403
    })
  }
  return caller
}

function splitStreamDelta(value: string): string[] {
  if (value.length === 0) return []
  if (value.length <= MAX_STREAM_DELTA_CHARACTERS) return [value]
  const chunks: string[] = []
  let offset = 0
  while (offset < value.length) {
    let end = Math.min(value.length, offset + MAX_STREAM_DELTA_CHARACTERS)
    const lastCodeUnit = value.charCodeAt(end - 1)
    if (end < value.length && lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1
    chunks.push(value.slice(offset, end))
    offset = end
  }
  return chunks
}

function toUsage(event: Extract<LLMCoreStreamEvent, { type: 'usage' }>): ModelInvokeEvent {
  return ModelInvokeEventSchema.parse({
    type: 'usage',
    usage: {
      promptTokens: event.usage.prompt_tokens,
      completionTokens: event.usage.completion_tokens,
      totalTokens: event.usage.total_tokens,
      ...(event.usage.cached_tokens !== undefined
        ? { cachedTokens: event.usage.cached_tokens }
        : {}),
      ...(event.usage.cache_write_tokens !== undefined
        ? { cacheWriteTokens: event.usage.cache_write_tokens }
        : {})
    }
  })
}

function providerFailureIsRetryable(
  statusCode: number | undefined,
  retryable: boolean | undefined
) {
  if (retryable !== undefined) return retryable
  if (statusCode === undefined) return true
  return statusCode === 408 || statusCode === 409 || statusCode === 429 || statusCode >= 500
}

export class CliComputeService {
  private readonly now: () => number
  private readonly log: Pick<Console, 'warn'>

  constructor(private readonly options: CliComputeServiceOptions) {
    this.now = options.now ?? Date.now
    this.log = options.log ?? console
  }

  listPublicProviders(enabledOnly = false): PublicProvider[] {
    const providers = this.options.providerSettings
      .getProviders()
      .filter((provider) => !enabledOnly || provider.enable)
    if (providers.length > MAX_PUBLIC_PROVIDERS) {
      throw new CliRequestError('result_too_large', 'Provider list exceeds the public limit', {
        httpStatus: 413
      })
    }

    let totalModels = 0
    return providers.map((provider) => {
      const modelsById = new Map(
        [
          ...this.options.providerSettings.getProviderModels(provider.id),
          ...this.options.providerSettings.getCustomModels(provider.id)
        ].map((model) => [model.id, model] as const)
      )
      totalModels += modelsById.size
      if (totalModels > MAX_PUBLIC_MODELS) {
        throw new CliRequestError('result_too_large', 'Model list exceeds the public limit', {
          httpStatus: 413
        })
      }
      const status = this.options.providerSettings.getBatchModelStatus(
        provider.id,
        Array.from(modelsById.keys())
      )
      const models = Array.from(modelsById.values())
        .map((model) => ({
          id: model.id,
          name: model.name,
          group: model.group,
          enabled: status[model.id] ?? false,
          custom: model.isCustom === true,
          vision: model.vision === true,
          functionCall: model.functionCall === true,
          reasoning: model.reasoning === true,
          enableSearch: model.enableSearch === true,
          ...(model.type ? { type: model.type } : {}),
          ...(model.contextLength !== undefined ? { contextLength: model.contextLength } : {}),
          ...(model.maxTokens !== undefined ? { maxTokens: model.maxTokens } : {})
        }))
        .filter((model) => !enabledOnly || model.enabled)

      return PublicProviderSchema.parse({
        ...toPublicProviderSummary(provider),
        models
      })
    })
  }

  async dispatchStream(
    method: string,
    rawInput: unknown,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    emit: ComputeEmitter
  ): Promise<unknown> {
    switch (method) {
      case modelsInvokeRoute.name:
        return await this.invokeModel(modelsInvokeRoute.input.parse(rawInput), signal, emit)
      case imagesGenerateRoute.name:
        return await this.generateImages(
          imagesGenerateRoute.input.parse(rawInput),
          caller,
          requestId,
          signal,
          emit
        )
      case videosGenerateRoute.name:
        return await this.generateVideos(
          videosGenerateRoute.input.parse(rawInput),
          caller,
          requestId,
          signal,
          emit
        )
      case speechGenerateRoute.name:
        return await this.generateSpeech(
          speechGenerateRoute.input.parse(rawInput),
          caller,
          requestId,
          signal,
          emit
        )
      default:
        throw new CliRequestError('not_found', 'Streaming method is not implemented', {
          httpStatus: 404
        })
    }
  }

  private requireAvailableModel(providerId: string, modelId: string): ModelConfig {
    const provider = this.options.providerSettings.getProviderById(providerId)
    if (!provider?.enable) {
      throw new CliRequestError('not_found', 'Provider is not available', { httpStatus: 404 })
    }
    if (!this.options.providerSettings.isKnownModel(providerId, modelId)) {
      throw new CliRequestError('not_found', 'Model is not available', { httpStatus: 404 })
    }
    if (!this.options.providerSettings.getModelStatus(providerId, modelId)) {
      throw new CliRequestError('conflict', 'Model is disabled', { httpStatus: 409 })
    }
    return this.options.providerSettings.getModelConfig(modelId, providerId)
  }

  private async invokeModel(
    input: ModelInvokeInput,
    signal: AbortSignal,
    emit: ComputeEmitter
  ): Promise<ModelInvokeOutput> {
    const startedAt = this.now()
    let providerError: Extract<LLMCoreStreamEvent, { type: 'error' }> | undefined
    let emittedEvents = 0
    const emitEvent = async (event: ModelInvokeEvent): Promise<void> => {
      if (emittedEvents >= MAX_MODEL_STREAM_EVENTS) {
        throw new CliRequestError('result_too_large', 'Model stream exceeds the event limit', {
          httpStatus: 413
        })
      }
      emittedEvents += 1
      await emit(modelsInvokeRoute.name, event)
    }
    try {
      signal.throwIfAborted()
      const modelConfig = this.requireAvailableModel(input.providerId, input.modelId)
      if (modelConfig.type !== ModelType.Chat) {
        throw new CliRequestError('conflict', 'Model is not configured for raw text invocation', {
          httpStatus: 409
        })
      }

      const queueStartedAt = this.now()
      let queuedEmission = Promise.resolve()
      let queuedEmissionFailure: { error: unknown } | undefined
      let admissionFailure: { error: unknown } | undefined
      try {
        await this.options.providerRuntime.executeWithRateLimit(input.providerId, {
          signal,
          onQueued: (snapshot) => {
            const event = ModelInvokeEventSchema.parse({
              type: 'rate_limit',
              providerId: snapshot.providerId,
              qpsLimit: snapshot.qpsLimit,
              currentQps: snapshot.currentQps,
              queueLength: snapshot.queueLength,
              estimatedWaitTimeMs: snapshot.estimatedWaitTime
            })
            queuedEmission = queuedEmission.then(async () => {
              if (queuedEmissionFailure) return
              try {
                await emitEvent(event)
              } catch (error) {
                queuedEmissionFailure = { error }
              }
            })
          }
        })
      } catch (error) {
        admissionFailure = { error }
      }
      const queueFinishedAt = this.now()
      await queuedEmission
      if (admissionFailure) throw admissionFailure.error
      if (queuedEmissionFailure) throw queuedEmissionFailure.error

      const stream = this.options.providerRuntime.streamChat(
        input.providerId,
        input.messages,
        input.modelId,
        modelConfig,
        input.temperature ?? modelConfig.temperature ?? 0.7,
        input.maxTokens ?? modelConfig.maxTokens,
        [],
        { signal }
      )
      const textChunks: string[] = []
      const reasoningChunks: string[] = []
      let outputCharacters = 0
      let usage: ModelInvokeOutput['usage']
      let finishReason: ProviderRoundStopReason | undefined
      let firstEventAt: number | undefined
      let firstTextAt: number | undefined

      for await (const event of stream) {
        signal.throwIfAborted()
        let eventAt: number | undefined
        if (firstEventAt === undefined) {
          eventAt = this.now()
          firstEventAt = eventAt
        }
        switch (event.type) {
          case 'text':
          case 'reasoning': {
            const delta = event.type === 'text' ? event.content : event.reasoning_content
            outputCharacters += delta.length
            if (outputCharacters > MODEL_INVOKE_MAX_OUTPUT_CHARACTERS) {
              throw new CliRequestError('result_too_large', 'Model output exceeds the text limit', {
                httpStatus: 413
              })
            }
            if (event.type === 'text' && firstTextAt === undefined && delta.length > 0) {
              firstTextAt = eventAt ?? this.now()
            }
            if (event.type === 'text') textChunks.push(delta)
            else reasoningChunks.push(delta)
            for (const chunk of splitStreamDelta(delta)) {
              await emitEvent(
                ModelInvokeEventSchema.parse({
                  type: event.type === 'text' ? 'text_delta' : 'reasoning_delta',
                  text: chunk
                })
              )
            }
            break
          }
          case 'usage': {
            const usageEvent = toUsage(event)
            usage = usageEvent.type === 'usage' ? usageEvent.usage : undefined
            await emitEvent(usageEvent)
            break
          }
          case 'rate_limit':
            await emitEvent(
              ModelInvokeEventSchema.parse({
                type: 'rate_limit',
                providerId: event.rate_limit.providerId,
                qpsLimit: event.rate_limit.qpsLimit,
                currentQps: event.rate_limit.currentQps,
                queueLength: event.rate_limit.queueLength,
                ...(event.rate_limit.estimatedWaitTime !== undefined
                  ? { estimatedWaitTimeMs: event.rate_limit.estimatedWaitTime }
                  : {})
              })
            )
            break
          case 'stop':
            finishReason = event.stop_reason
            await emitEvent(
              ModelInvokeEventSchema.parse({ type: 'stop', reason: event.stop_reason })
            )
            break
          case 'error':
            providerError = event
            throw new Error('Provider returned an error event')
          case 'tool_call_start':
          case 'tool_call_chunk':
          case 'tool_call_end':
          case 'permission':
          case 'plan':
          case 'image_data':
            throw new CliRequestError(
              'conflict',
              'Raw model invocation returned an unsupported event',
              { httpStatus: 409 }
            )
        }
      }

      if (!finishReason) {
        throw new Error('Provider stream ended without a stop event')
      }
      if (finishReason === 'error') {
        throw new Error('Provider stream stopped with an error')
      }
      const text = textChunks.join('')
      const reasoning = reasoningChunks.join('')
      return modelsInvokeRoute.output.parse({
        providerId: input.providerId,
        modelId: input.modelId,
        text,
        ...(reasoning ? { reasoning } : {}),
        ...(usage ? { usage } : {}),
        finishReason,
        latency: {
          queueMs: Math.max(0, queueFinishedAt - queueStartedAt),
          firstEventMs: firstEventAt === undefined ? null : Math.max(0, firstEventAt - startedAt),
          firstTextMs: firstTextAt === undefined ? null : Math.max(0, firstTextAt - startedAt),
          totalMs: Math.max(0, this.now() - startedAt)
        }
      })
    } catch (error) {
      if (error instanceof CliRequestError) throw error
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new CliRequestError('cancelled', 'Model invocation was cancelled', {
          retriable: true
        })
      }
      const metadata = extractProviderFailureMetadata(providerError ?? error)
      const failure = ModelInvokeProviderFailureSchema.parse({
        ...(metadata?.statusCode !== undefined ? { statusCode: metadata.statusCode } : {}),
        retryable: providerFailureIsRetryable(metadata?.statusCode, metadata?.retryable)
      })
      this.log.warn('[CLI] Model invocation failed', {
        providerId: input.providerId,
        modelId: input.modelId,
        failure
      })
      throw new CliRequestError('unavailable', 'Model provider request failed', {
        httpStatus: 503,
        retriable: failure.retryable,
        details: { providerFailure: failure }
      })
    }
  }

  private async generateImages(
    input: ImageGenerationInput,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    emit: ComputeEmitter
  ): Promise<ImageGenerationOutput> {
    const startedAt = this.now()
    try {
      const modelConfig = this.requireAvailableModel(input.providerId, input.modelId)
      if (
        modelConfig.type !== ModelType.ImageGeneration &&
        modelConfig.apiEndpoint !== ApiEndpointType.Image &&
        modelConfig.endpointType !== 'image-generation'
      ) {
        throw new CliRequestError('conflict', 'Model is not configured for image generation', {
          httpStatus: 409
        })
      }
      await this.emitMediaStarted(imagesGenerateRoute.name, input, emit)
      const result = await this.options.providerRuntime.generateImageStandalone(
        input.providerId,
        input.prompt,
        input.modelId,
        input.options,
        { signal }
      )
      this.requireMatchingMediaIdentity(result, input)
      const artifacts = await this.persistMedia(
        imagesGenerateRoute.name,
        result.images,
        'image',
        8,
        caller,
        requestId,
        signal,
        emit
      )
      return imagesGenerateRoute.output.parse({
        providerId: input.providerId,
        modelId: input.modelId,
        artifacts,
        ...(input.options ? { requestedOptions: input.options } : {}),
        durationMs: Math.max(0, this.now() - startedAt)
      })
    } catch (error) {
      throw this.normalizeMediaFailure(error, input, signal, 'Image generation failed')
    }
  }

  private async generateVideos(
    input: VideoGenerationInput,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    emit: ComputeEmitter
  ): Promise<VideoGenerationOutput> {
    const startedAt = this.now()
    try {
      const modelConfig = this.requireAvailableModel(input.providerId, input.modelId)
      if (!isVideoGenerationModelConfig(modelConfig, input.modelId)) {
        throw new CliRequestError('conflict', 'Model is not configured for video generation', {
          httpStatus: 409
        })
      }
      await this.emitMediaStarted(videosGenerateRoute.name, input, emit)
      const result = await this.options.providerRuntime.generateVideoStandalone(
        input.providerId,
        input.prompt,
        input.modelId,
        input.options,
        { signal }
      )
      this.requireMatchingMediaIdentity(result, input)
      const artifacts = await this.persistMedia(
        videosGenerateRoute.name,
        result.videos,
        'video',
        4,
        caller,
        requestId,
        signal,
        emit
      )
      return videosGenerateRoute.output.parse({
        providerId: input.providerId,
        modelId: input.modelId,
        artifacts,
        ...(input.options ? { requestedOptions: input.options } : {}),
        durationMs: Math.max(0, this.now() - startedAt)
      })
    } catch (error) {
      throw this.normalizeMediaFailure(error, input, signal, 'Video generation failed')
    }
  }

  private async generateSpeech(
    input: SpeechGenerationInput,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    emit: ComputeEmitter
  ): Promise<SpeechGenerationOutput> {
    const startedAt = this.now()
    try {
      const modelConfig = this.requireAvailableModel(input.providerId, input.modelId)
      if (!isTtsModelConfig(modelConfig) && !isTtsModelId(input.modelId)) {
        throw new CliRequestError('conflict', 'Model is not configured for speech generation', {
          httpStatus: 409
        })
      }
      await this.emitMediaStarted(speechGenerateRoute.name, input, emit)
      const result = await this.options.providerRuntime.generateSpeechStandalone(
        input.providerId,
        input.text,
        input.modelId,
        input.options,
        { signal }
      )
      this.requireMatchingMediaIdentity(result, input)
      const artifacts = await this.persistMedia(
        speechGenerateRoute.name,
        [result.audio],
        'audio',
        1,
        caller,
        requestId,
        signal,
        emit
      )
      return speechGenerateRoute.output.parse({
        providerId: input.providerId,
        modelId: input.modelId,
        artifacts,
        ...(input.options ? { requestedOptions: input.options } : {}),
        durationMs: Math.max(0, this.now() - startedAt)
      })
    } catch (error) {
      throw this.normalizeMediaFailure(error, input, signal, 'Speech generation failed')
    }
  }

  private async emitMediaStarted(
    method: string,
    input: { providerId: string; modelId: string },
    emit: ComputeEmitter
  ): Promise<void> {
    await emit(
      method,
      MediaGenerationEventSchema.parse({
        type: 'started',
        providerId: input.providerId,
        modelId: input.modelId
      })
    )
  }

  private requireMatchingMediaIdentity(
    result: { providerId: string; modelId: string },
    input: { providerId: string; modelId: string }
  ): void {
    if (result.providerId !== input.providerId || result.modelId !== input.modelId) {
      throw new CliRequestError('unavailable', 'Provider returned inconsistent media output', {
        httpStatus: 503,
        retriable: true
      })
    }
  }

  private async persistMedia(
    method: string,
    outputs: readonly { data: string; mimeType: string }[],
    kind: GeneratedMediaKind,
    maxOutputs: number,
    caller: CliRouteCaller,
    requestId: string,
    signal: AbortSignal,
    emit: ComputeEmitter
  ) {
    const artifactSpool = this.options.artifactSpool
    const mediaCacheDirectory = this.options.mediaCacheDirectory
    if (!artifactSpool || !mediaCacheDirectory) {
      throw new CliRequestError('unavailable', 'Media artifact service is unavailable', {
        httpStatus: 503,
        retriable: true
      })
    }
    if (outputs.length === 0) {
      throw new CliRequestError('unavailable', `Provider returned no ${kind} output`, {
        httpStatus: 503,
        retriable: true
      })
    }
    if (outputs.length > maxOutputs) {
      throw new CliRequestError('result_too_large', `Provider returned too many ${kind} outputs`, {
        httpStatus: 413
      })
    }

    const artifacts: ArtifactMetadata[] = []
    try {
      for (const [index, output] of outputs.entries()) {
        signal.throwIfAborted()
        const resolved = await resolveGeneratedMedia(
          output.data,
          output.mimeType,
          kind,
          mediaCacheDirectory
        )
        try {
          const artifact = await artifactSpool.write({
            caller,
            requestId,
            mimeType: resolved.mimeType,
            suggestedFilename: `generated-${kind}-${index + 1}${artifactExtensionForMimeType(resolved.mimeType)}`,
            data: resolved.data,
            signal
          })
          if (artifact.size !== resolved.expectedBytes) {
            await artifactSpool.discard(artifact.id)
            throw new CliRequestError('unavailable', 'Generated media changed while being stored', {
              httpStatus: 503,
              retriable: true
            })
          }
          artifacts.push(artifact)
        } finally {
          await resolved.dispose?.()
        }
      }
      for (const [index, artifact] of artifacts.entries()) {
        const event: MediaGenerationEvent = MediaGenerationEventSchema.parse({
          type: 'artifact',
          index,
          artifact
        })
        await emit(method, event)
      }
      return artifacts
    } catch (error) {
      await Promise.allSettled(artifacts.map((artifact) => artifactSpool.discard(artifact.id)))
      throw error
    }
  }

  private normalizeMediaFailure(
    error: unknown,
    input: { providerId: string; modelId: string },
    signal: AbortSignal,
    message: string
  ): CliRequestError {
    if (error instanceof CliRequestError) return error
    if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return new CliRequestError('cancelled', 'Media generation was cancelled', {
        retriable: true
      })
    }
    this.log.warn('[CLI] Media generation failed', {
      providerId: input.providerId,
      modelId: input.modelId,
      failure: { name: error instanceof Error ? error.name : typeof error }
    })
    return new CliRequestError('unavailable', message, { httpStatus: 503, retriable: true })
  }
}

export function createCliComputeRoutes(service: CliComputeService): DeepchatRouteMap {
  return createRouteMap([
    [
      providersListPublicRoute.name,
      async (rawInput, context) => {
        requireCliCaller(context.caller)
        const input = providersListPublicRoute.input.parse(rawInput)
        return providersListPublicRoute.output.parse({
          providers: service.listPublicProviders(input.enabledOnly ?? false)
        })
      }
    ]
  ])
}
