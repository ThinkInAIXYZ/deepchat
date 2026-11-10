import type { LLMCoreStreamEvent } from '@shared/types/core/llm-events'
import type { JsonValue } from '@shared/contracts/json'
import type { DimRuntimeSupervisor } from './runtimeSupervisor'

type JsonObject = { [key: string]: JsonValue }
export interface DimModelId {
  providerId: string
  modelId: string
}
export interface DimModelConfiguration {
  key: string
  displayName: string
  connection: JsonObject
  model: JsonObject & { modelId: string }
}
export interface DimAuxiliaryRequest {
  system?: string
  messages: JsonObject[]
  maxOutputTokens?: number
}
export interface DimModelParameters {
  temperature?: number
  topP?: number
  maxTokens?: number
  reasoning?: JsonObject
  providerOptions?: JsonObject
}
export interface DimAuxiliaryReply {
  text: string
  stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence'
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    cost?: number
    currency?: string
  }
}

/** Configuration goes to the injected plugin; all inference stays in dim's Rust owners. */
export class DimModelBridge {
  constructor(private readonly host: DimRuntimeSupervisor) {}

  async configure(config: DimModelConfiguration): Promise<DimModelId> {
    const client = await this.host.start()
    const target = await client.call<DimModelId>(
      'deepchat.model.configure',
      config as unknown as JsonValue
    )
    if (this.host.usesNativePlugins)
      await client.call('deepchat.native_media.refresh', { providerId: target.providerId })
    return target
  }

  async embed(
    model: DimModelId,
    values: string[],
    signal?: AbortSignal
  ): Promise<{ vectors: number[][] }> {
    signal?.throwIfAborted()
    const client = await this.host.openConnection()
    const cancel = () => client.close()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      signal?.throwIfAborted()
      return await client.call(
        'deepchat.native_embeddings.embed',
        { model: { ...model }, values },
        30 * 60 * 1000
      )
    } catch (error) {
      signal?.throwIfAborted()
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
      client.close()
    }
  }

  /** One caller connection per stream keeps cancellation and notices scoped to this invocation. */
  async *stream(
    model: DimModelId,
    request: DimAuxiliaryRequest,
    signal?: AbortSignal,
    config?: DimModelParameters
  ): AsyncGenerator<LLMCoreStreamEvent> {
    signal?.throwIfAborted()
    const client = await this.host.openConnection()
    const pending: Array<{ event: LLMCoreStreamEvent; bytes: number }> = []
    let bytes = 0
    let received = 0
    let done = false
    let failure: unknown
    let wake: (() => void) | undefined
    const notify = () => {
      wake?.()
      wake = undefined
    }
    const cancel = () => {
      client.close()
      notify()
    }
    const notice = (message: { method: string; params: unknown }) => {
      if (message.method !== 'management.progress') return
      const progress = message.params as
        | { method?: string; data?: { sequence?: unknown; event?: unknown } }
        | undefined
      if (progress?.method !== 'deepchat.native.stream') return
      const data = progress.data
      if (data?.sequence !== String(received + 1) || !isModelDelta(data.event)) {
        failure = new Error('Native model stream lost or received an invalid event')
        cancel()
        return
      }
      received++
      const event = data.event
      const size = Buffer.byteLength(JSON.stringify(event))
      if (bytes + size > 4 * 1024 * 1024) {
        failure = new Error('Native model stream consumer exceeded its buffer limit')
        cancel()
        return
      }
      pending.push({ event, bytes: size })
      bytes += size
      notify()
    }
    client.on('notification', notice)
    signal?.addEventListener('abort', cancel, { once: true })
    let operation: Promise<unknown> | undefined
    try {
      signal?.throwIfAborted()
      operation = client
        .call<{ eventCount: string }>(
          'deepchat.native.stream',
          {
            model,
            request,
            config: config ?? {}
          } as unknown as JsonValue,
          30 * 60 * 1000
        )
        .then(
          (reply) => {
            if (reply.eventCount !== String(received))
              failure = new Error('Native model stream lost its final progress events')
            done = true
            notify()
          },
          (error: unknown) => {
            failure ??= error
            done = true
            notify()
          }
        )
      while (true) {
        signal?.throwIfAborted()
        const next = pending.shift()
        if (next) {
          bytes -= next.bytes
          yield next.event
          continue
        }
        if (failure) throw failure
        if (done) return
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      signal?.removeEventListener('abort', cancel)
      client.off('notification', notice)
      client.close()
      await operation
    }
  }

  async complete(
    model: DimModelId,
    request: DimAuxiliaryRequest,
    signal?: AbortSignal,
    config?: DimModelParameters
  ): Promise<DimAuxiliaryReply> {
    signal?.throwIfAborted()
    const client = await this.host.openConnection()
    const cancel = () => client.close()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      signal?.throwIfAborted()
      return await client.call(
        config ? 'deepchat.native.complete' : 'deepchat.model.complete',
        { model, request, ...(config ? { config } : {}) } as unknown as JsonValue,
        30 * 60 * 1000
      )
    } catch (error) {
      signal?.throwIfAborted()
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
      client.close()
    }
  }
}

function isModelDelta(value: unknown): value is LLMCoreStreamEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Record<string, unknown>
  if (event.type === 'text') return typeof event.content === 'string'
  if (event.type === 'reasoning') return typeof event.reasoning_content === 'string'
  if (event.type === 'stop') return ['complete', 'max_tokens'].includes(String(event.stop_reason))
  if (event.type !== 'usage' || !event.usage || typeof event.usage !== 'object') return false
  const usage = event.usage as Record<string, unknown>
  return ['prompt_tokens', 'completion_tokens', 'total_tokens'].every(
    (name) => typeof usage[name] === 'number' && Number.isFinite(usage[name]) && usage[name] >= 0
  )
}
