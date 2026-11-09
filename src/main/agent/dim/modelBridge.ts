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
    return client.call('deepchat.model.configure', config as unknown as JsonValue)
  }

  async complete(
    model: DimModelId,
    request: DimAuxiliaryRequest,
    signal?: AbortSignal
  ): Promise<DimAuxiliaryReply> {
    signal?.throwIfAborted()
    const client = await this.host.openConnection()
    const cancel = () => client.close()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      signal?.throwIfAborted()
      return await client.call(
        'deepchat.model.complete',
        { model, request } as unknown as JsonValue,
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
