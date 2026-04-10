import type { MCPToolDefinition, ModelConfig } from '@shared/presenter'
import type { ModelMessage } from 'ai'
import { resolvePromptCachePlan } from '../promptCacheStrategy'

type ProviderOptionsRecord = Record<string, Record<string, unknown>>

function cloneMessage(message: ModelMessage): ModelMessage {
  return {
    ...(message as any),
    ...(Array.isArray((message as any).content)
      ? {
          content: (message as any).content.map((part: any) => ({ ...part }))
        }
      : {})
  } as ModelMessage
}

function applyExplicitAnthropicCacheBreakpoint(messages: ModelMessage[]): ModelMessage[] {
  const cloned = messages.map(cloneMessage)

  for (let messageIndex = cloned.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = cloned[messageIndex]

    if (message.role === 'system') {
      continue
    }

    if (!Array.isArray(message.content)) {
      continue
    }

    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.content[partIndex]
      if (part?.type !== 'text' || typeof part.text !== 'string' || !part.text.trim()) {
        continue
      }

      message.content[partIndex] = {
        ...part,
        providerOptions: {
          ...(part.providerOptions as Record<string, unknown> | undefined),
          anthropic: {
            cacheControl: {
              type: 'ephemeral'
            }
          }
        }
      }

      return cloned
    }
  }

  return cloned
}

export interface BuildProviderOptionsParams {
  providerId: string
  providerOptionsKey: string
  apiType:
    | 'openai_chat'
    | 'openai_responses'
    | 'anthropic'
    | 'google'
    | 'vertex'
    | 'bedrock'
    | 'ollama'
  modelId: string
  modelConfig: ModelConfig
  tools: MCPToolDefinition[]
  messages: ModelMessage[]
}

export interface ProviderOptionsMappingResult {
  messages: ModelMessage[]
  providerOptions?: ProviderOptionsRecord
}

function isOfficialAnthropicProvider(providerId: string): boolean {
  return providerId.trim().toLowerCase() === 'anthropic'
}

export function buildProviderOptions(
  params: BuildProviderOptionsParams
): ProviderOptionsMappingResult {
  const providerOptions: ProviderOptionsRecord = {}
  let messages = params.messages

  const promptCachePlan = resolvePromptCachePlan({
    providerId: params.providerId,
    apiType:
      params.apiType === 'openai_responses'
        ? 'openai_responses'
        : params.apiType === 'anthropic' || params.apiType === 'bedrock'
          ? 'anthropic'
          : 'openai_chat',
    modelId: params.modelId,
    messages: params.messages as unknown[],
    tools: params.tools,
    conversationId: params.modelConfig.conversationId
  })

  switch (params.apiType) {
    case 'openai_chat':
    case 'openai_responses': {
      const config: Record<string, unknown> = {}
      if (params.modelConfig.reasoningEffort) {
        config.reasoningEffort = params.modelConfig.reasoningEffort
      }
      if (params.modelConfig.verbosity) {
        config.textVerbosity = params.modelConfig.verbosity
      }
      if (params.modelConfig.maxCompletionTokens) {
        config.maxCompletionTokens = params.modelConfig.maxCompletionTokens
      }
      if (promptCachePlan.cacheKey) {
        config.promptCacheKey = promptCachePlan.cacheKey
      }
      if (Object.keys(config).length > 0) {
        providerOptions[params.providerOptionsKey] = config
      }
      break
    }

    case 'anthropic':
    case 'bedrock': {
      const officialAnthropicProvider =
        params.apiType === 'anthropic' && isOfficialAnthropicProvider(params.providerId)
      const config: Record<string, unknown> = {
        toolStreaming: officialAnthropicProvider
      }
      if (officialAnthropicProvider && params.modelConfig.reasoning) {
        config.sendReasoning = true
      }
      if (officialAnthropicProvider && params.modelConfig.reasoningEffort) {
        config.effort =
          params.modelConfig.reasoningEffort === 'low'
            ? 'low'
            : params.modelConfig.reasoningEffort === 'high'
              ? 'high'
              : 'medium'
      }
      if (params.modelConfig.thinkingBudget !== undefined) {
        config.thinking = {
          type: 'enabled',
          budgetTokens: params.modelConfig.thinkingBudget
        }
      }
      if (promptCachePlan.mode === 'anthropic_auto') {
        config.cacheControl = {
          type: 'ephemeral'
        }
      }
      if (Object.keys(config).length > 0) {
        providerOptions.anthropic = config
      }
      if (promptCachePlan.mode === 'anthropic_explicit') {
        messages = applyExplicitAnthropicCacheBreakpoint(messages)
      }
      break
    }

    case 'google': {
      const config: Record<string, unknown> = {}
      if (params.tools.length > 0) {
        config.streamFunctionCallArguments = true
      }
      if (params.modelConfig.thinkingBudget !== undefined || params.modelConfig.reasoningEffort) {
        config.thinkingConfig = {
          ...(params.modelConfig.thinkingBudget !== undefined
            ? { thinkingBudget: params.modelConfig.thinkingBudget }
            : {}),
          ...(params.modelConfig.reasoningEffort
            ? { thinkingLevel: params.modelConfig.reasoningEffort }
            : {}),
          includeThoughts: true
        }
      }
      if (Object.keys(config).length > 0) {
        providerOptions[params.providerOptionsKey] = config
      }
      break
    }

    case 'vertex': {
      const config: Record<string, unknown> = {
        streamFunctionCallArguments: params.tools.length > 0
      }
      if (params.modelConfig.thinkingBudget !== undefined || params.modelConfig.reasoningEffort) {
        config.thinkingConfig = {
          ...(params.modelConfig.thinkingBudget !== undefined
            ? { thinkingBudget: params.modelConfig.thinkingBudget }
            : {}),
          ...(params.modelConfig.reasoningEffort
            ? { thinkingLevel: params.modelConfig.reasoningEffort }
            : {}),
          includeThoughts: true
        }
      }
      providerOptions[params.providerOptionsKey] = config
      break
    }

    case 'ollama': {
      const config: Record<string, unknown> = {}
      if (params.modelConfig.reasoningEffort) {
        config.reasoning_effort = params.modelConfig.reasoningEffort
      }
      if (Object.keys(config).length > 0) {
        providerOptions[params.providerOptionsKey] = config
      }
      break
    }
  }

  return {
    messages,
    providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined
  }
}
