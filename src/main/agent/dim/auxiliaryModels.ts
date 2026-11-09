import type { ChatMessage, ChatMessageContent } from '@shared/types/core/chat-message'
import type { JsonValue } from '@shared/contracts/json'
import type { DimModelCatalog } from './modelCatalog'
import type {
  DimModelBridge,
  DimAuxiliaryReply,
  DimAuxiliaryRequest,
  DimModelParameters
} from './modelBridge'

type JsonObject = { [key: string]: JsonValue }
interface AuxiliaryOptions {
  models: Pick<DimModelCatalog, 'admit'>
  bridge: Pick<DimModelBridge, 'complete'>
  parameters?(providerId: string, modelId: string): DimModelParameters
}

/** Product catalog admission and neutral messages. Rust owns every model invocation. */
export class DimAuxiliaryModels {
  constructor(private readonly options: AuxiliaryOptions) {}

  async complete(input: {
    providerId: string
    modelId: string
    messages: ChatMessage[]
    parameters?: DimModelParameters
    signal?: AbortSignal
  }): Promise<DimAuxiliaryReply> {
    input.signal?.throwIfAborted()
    const request = dimAuxiliaryRequest(input.messages)
    const model = await this.options.models.admit(input.providerId, input.modelId)
    input.signal?.throwIfAborted()
    const defaults = this.options.parameters?.(input.providerId, input.modelId)
    const parameters =
      defaults || input.parameters
        ? {
            ...defaults,
            ...Object.fromEntries(
              Object.entries(input.parameters ?? {}).filter(([, value]) => value !== undefined)
            )
          }
        : undefined
    return this.options.bridge.complete(model, request, input.signal, parameters)
  }
}

/** Translate the desktop message contract to dim's language-neutral auxiliary contract. */
export function dimAuxiliaryRequest(messages: readonly ChatMessage[]): DimAuxiliaryRequest {
  const system: string[] = []
  const content: JsonObject[] = []
  for (const message of messages) {
    if (message.provider_replay)
      throw new Error('Native auxiliary input cannot resume a legacy provider replay')
    if (message.role === 'system') {
      if (Array.isArray(message.content) && message.content.some((part) => part.type !== 'text'))
        throw new Error('Native system input must be text')
      system.push(
        typeof message.content === 'string'
          ? message.content
          : (message.content ?? [])
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('\n')
      )
      continue
    }
    const blocks = dimContentBlocks(message.content)
    if (message.role === 'tool') {
      if (!message.tool_call_id) throw new Error('Native tool history requires its call identity')
      content.push({
        role: 'tool_result',
        content: [{ type: 'tool_result', tool_use_id: message.tool_call_id, content: blocks }]
      })
      continue
    }
    const parts: JsonValue[] = [...blocks]
    for (const call of message.tool_calls ?? []) {
      const input: unknown = JSON.parse(call.function.arguments)
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Native tool history requires object arguments')
      parts.push({
        type: 'tool_use',
        id: call.id,
        name: call.function.name,
        input: input as JsonObject
      })
    }
    content.push({ role: message.role, content: parts.length ? parts : '' })
  }
  if (!content.length) throw new Error('Native auxiliary input requires a conversation message')
  return { ...(system.length ? { system: system.join('\n\n') } : {}), messages: content }
}

/** Native core text/image values; preparation of audio belongs to dim Modality. */
export function dimContentBlocks(content: ChatMessage['content']): JsonObject[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return (content ?? []).map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.type === 'input_audio')
      throw new Error('Audio must be prepared through dim Modality before auxiliary completion')
    return nativeImage(part)
  })
}
function nativeImage(part: Extract<ChatMessageContent, { type: 'image_url' }>): JsonObject {
  const value = part.image_url.url
  const inline = /^data:(image\/[^;,]+);base64,([\s\S]+)$/i.exec(value)
  if (inline)
    return { type: 'image', source: { type: 'base64', mediaType: inline[1], data: inline[2] } }
  const url = new URL(value)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Native image input requires inline bytes or an HTTP(S) reference')
  return {
    type: 'image',
    source: { type: 'url', mediaType: 'image/*', url: value }
  }
}
