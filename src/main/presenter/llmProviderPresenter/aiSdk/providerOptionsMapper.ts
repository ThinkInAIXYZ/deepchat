import type { MCPToolDefinition, ModelConfig } from '@shared/presenter'
import type { ModelMessage } from 'ai'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue
} from '@shared/types/model-db'
import { resolvePromptCachePlan } from '../promptCacheStrategy'
import { modelCapabilities } from '../../configPresenter/modelCapabilities'
import { providerDbLoader } from '../../configPresenter/providerDbLoader'

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
  capabilityProviderId: string
  supportsOfficialAnthropicReasoning?: boolean
  providerOptionsKey: string
  apiType:
    | 'openai_chat'
    | 'openai_responses'
    | 'azure_responses'
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

function supportsDoubaoThinking(providerId: string, modelId: string): boolean {
  if (providerId !== 'doubao') {
    return false
  }

  const model = providerDbLoader.getModel(providerId, modelId)
  const notes = model?.extra_capabilities?.reasoning?.notes
  return Array.isArray(notes) && notes.includes('doubao-thinking-parameter')
}

function supportsSiliconcloudThinking(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()
  return [
    'qwen/qwen3-8b',
    'qwen/qwen3-14b',
    'qwen/qwen3-32b',
    'qwen/qwen3-30b-a3b',
    'qwen/qwen3-235b-a22b',
    'tencent/hunyuan-a13b-instruct',
    'zai-org/glm-4.5v',
    'deepseek-ai/deepseek-v3.1',
    'pro/deepseek-ai/deepseek-v3.1'
  ].some((supportedModel) => normalizedModelId.includes(supportedModel))
}

function supportsGrokReasoningEffort(modelId: string): boolean {
  return ['grok-3-mini', 'grok-3-mini-fast'].some((model) =>
    modelId.toLowerCase().includes(model.toLowerCase())
  )
}

export function buildProviderOptions(
  params: BuildProviderOptionsParams
): ProviderOptionsMappingResult {
  const providerOptions: ProviderOptionsRecord = {}
  let messages = params.messages
  const reasoningPortrait = modelCapabilities.getReasoningPortrait?.(
    params.capabilityProviderId,
    params.modelId
  )
  const reasoningEnabled = getReasoningEffectiveEnabledForProvider(
    params.capabilityProviderId,
    reasoningPortrait,
    {
      reasoning: params.modelConfig.reasoning,
      reasoningEffort: params.modelConfig.reasoningEffort
    }
  )
  const hasThinkingConfig =
    params.modelConfig.thinkingBudget !== undefined || Boolean(params.modelConfig.reasoningEffort)
  const shouldSendThinkingConfig =
    hasThinkingConfig && (reasoningPortrait ? reasoningEnabled : true)

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
      if (params.modelConfig.reasoningEffort && params.providerId !== 'grok') {
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
      if (supportsDoubaoThinking(params.providerId, params.modelId) && reasoningEnabled) {
        config.thinking = {
          type: 'enabled'
        }
      }
      if (
        params.providerId === 'siliconcloud' &&
        supportsSiliconcloudThinking(params.modelId) &&
        reasoningEnabled
      ) {
        config.enable_thinking = true
      }
      if (
        params.providerId === 'dashscope' &&
        modelCapabilities.supportsReasoning(params.providerId, params.modelId) &&
        reasoningEnabled
      ) {
        config.enable_thinking = true
        const dbBudget = modelCapabilities.getThinkingBudgetRange(
          params.providerId,
          params.modelId
        ).default
        const budget = params.modelConfig.thinkingBudget ?? dbBudget
        if (typeof budget === 'number') {
          config.thinking_budget = budget
        }
      }
      if (
        params.providerId === 'grok' &&
        params.modelConfig.reasoningEffort &&
        supportsGrokReasoningEffort(params.modelId)
      ) {
        config.reasoning_effort = params.modelConfig.reasoningEffort
      }
      if (Object.keys(config).length > 0) {
        providerOptions[params.providerOptionsKey] = config
      }
      break
    }

    case 'azure_responses': {
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
      if (Object.keys(config).length > 0) {
        providerOptions[params.providerOptionsKey] = config
      }
      break
    }

    case 'anthropic':
    case 'bedrock': {
      const officialAnthropicReasoningProvider =
        params.apiType === 'anthropic' && params.supportsOfficialAnthropicReasoning === true
      const anthropicReasoningToggle = hasAnthropicReasoningToggle(
        params.capabilityProviderId,
        reasoningPortrait
      )
      const config: Record<string, unknown> = {
        toolStreaming: officialAnthropicReasoningProvider
      }
      if (officialAnthropicReasoningProvider && reasoningEnabled) {
        config.sendReasoning = true
      }
      if (officialAnthropicReasoningProvider && anthropicReasoningToggle && reasoningEnabled) {
        const resolvedEffort =
          normalizeReasoningEffortValue(reasoningPortrait, params.modelConfig.reasoningEffort) ??
          normalizeReasoningEffortValue(reasoningPortrait, reasoningPortrait?.effort)
        const resolvedVisibility =
          normalizeAnthropicReasoningVisibilityValue(params.modelConfig.reasoningVisibility) ??
          normalizeAnthropicReasoningVisibilityValue(reasoningPortrait?.visibility) ??
          'omitted'
        if (resolvedEffort) {
          config.effort = resolvedEffort
        }
        config.thinking = {
          type: 'adaptive',
          display: resolvedVisibility
        }
      } else if (reasoningEnabled && params.modelConfig.thinkingBudget !== undefined) {
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
      if (shouldSendThinkingConfig) {
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
      if (shouldSendThinkingConfig) {
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
