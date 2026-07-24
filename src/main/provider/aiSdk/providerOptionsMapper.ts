import type { MCPToolDefinition } from '@shared/types/mcp'
import type { ModelConfig } from '@shared/types/provider'
import type { ModelMessage } from 'ai'
import { resolveMoonshotKimiTemperaturePolicy } from '@shared/moonshotKimiPolicy'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue
} from '@shared/types/model-db'
import {
  OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER,
  type OpenAICompatiblePromptCacheMarker,
  type PromptCacheIntent,
  resolvePromptCachePlan
} from '../promptCacheStrategy'
import { modelCapabilities } from '../modelCapabilities'
import { providerDbLoader } from '../../provider/providerDbLoader'

type ProviderOptionsRecord = Record<string, Record<string, unknown>>
const OPENAI_CODEX_DEFAULT_INSTRUCTIONS =
  'You are DeepChat, an AI assistant. Follow the user instructions.'

function normalizeInstructionValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim()
        }

        if (item && typeof item === 'object' && 'text' in item && typeof item.text === 'string') {
          return item.text.trim()
        }

        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function extractSystemInstructions(messages: ModelMessage[]): string | undefined {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => normalizeInstructionValue(message.content))
    .filter(Boolean)
    .join('\n')
    .trim()

  return instructions || undefined
}

function hasReusableMessageContent(message: ModelMessage): boolean {
  if (typeof message.content === 'string') {
    return message.content.trim().length > 0
  }

  return Array.isArray(message.content) && message.content.length > 0
}

function applyBedrockCachePoint(
  messages: ModelMessage[],
  plan: ReturnType<typeof resolvePromptCachePlan>
): ModelMessage[] {
  if (plan.mode !== 'anthropic_explicit' || !plan.breakpointPlan) {
    return messages
  }

  const messageIndex = plan.breakpointPlan.messageIndex
  const message = messages[messageIndex]
  if (!message || !hasReusableMessageContent(message)) {
    return messages
  }

  const providerOptions = (message.providerOptions ?? {}) as ProviderOptionsRecord
  return messages.map((candidate, index) =>
    index === messageIndex
      ? ({
          ...candidate,
          providerOptions: {
            ...providerOptions,
            bedrock: {
              ...providerOptions.bedrock,
              cachePoint: {
                type: 'default'
              }
            }
          }
        } as ModelMessage)
      : candidate
  )
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
  modelId: string
  modelConfig: ModelConfig
  tools: MCPToolDefinition[]
  messages: ModelMessage[]
  cacheIntent?: PromptCacheIntent
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

function normalizeMiniMaxModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase()
  return normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized
}

function supportsMiniMaxAdaptiveThinking(
  providerId: string,
  capabilityProviderId: string,
  modelId: string
): boolean {
  const providerIds = [providerId, capabilityProviderId].map((id) => id.trim().toLowerCase())
  return (
    providerIds.some((id) => id === 'minimax' || id === 'minimax-cn') &&
    normalizeMiniMaxModelId(modelId) === 'minimax-m3'
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
  const fixedTemperatureKimi = resolveMoonshotKimiTemperaturePolicy(
    params.providerId,
    params.modelId,
    params.modelConfig.reasoning
  )
  const reasoningEnabled =
    fixedTemperatureKimi?.reasoningEnabled ??
    getReasoningEffectiveEnabledForProvider(params.capabilityProviderId, reasoningPortrait, {
      reasoning: params.modelConfig.reasoning,
      reasoningEffort: params.modelConfig.reasoningEffort
    })
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
    intent: params.cacheIntent ?? 'isolated',
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
      if (promptCachePlan.mode === 'openai_implicit' && promptCachePlan.cacheKey) {
        config.promptCacheKey = promptCachePlan.cacheKey
      }
      if (promptCachePlan.mode === 'anthropic_explicit') {
        const marker: OpenAICompatiblePromptCacheMarker = {
          version: 1,
          providerId: params.providerId,
          modelId: params.modelId,
          ...(promptCachePlan.cacheKey ? { cacheKey: promptCachePlan.cacheKey } : {})
        }
        config[OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER] = marker
      }
      if (fixedTemperatureKimi) {
        config.thinking = {
          type: fixedTemperatureKimi.thinkingType
        }
      }
      if (params.providerId === 'openai-codex' && params.apiType === 'openai_responses') {
        config.store = false
        config.instructions =
          extractSystemInstructions(params.messages) ?? OPENAI_CODEX_DEFAULT_INSTRUCTIONS
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

    case 'anthropic': {
      const officialAnthropicReasoningProvider = params.supportsOfficialAnthropicReasoning === true
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
      } else if (
        supportsMiniMaxAdaptiveThinking(
          params.providerId,
          params.capabilityProviderId,
          params.modelId
        ) &&
        reasoningEnabled
      ) {
        config.thinking = {
          type: 'adaptive'
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
      break
    }

    case 'bedrock': {
      const config: Record<string, unknown> = {}
      if (reasoningEnabled && params.modelConfig.thinkingBudget !== undefined) {
        config.reasoningConfig = {
          type: 'enabled',
          budgetTokens: params.modelConfig.thinkingBudget
        }
      }
      if (Object.keys(config).length > 0) {
        providerOptions.bedrock = config
      }
      if (promptCachePlan.mode === 'anthropic_explicit') {
        messages = applyBedrockCachePoint(messages, promptCachePlan)
      }
      break
    }

    case 'google': {
      const config: Record<string, unknown> = {}
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
  }

  return {
    messages,
    providerOptions: Object.keys(providerOptions).length > 0 ? providerOptions : undefined
  }
}
