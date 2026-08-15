import type { MCPToolDefinition } from '@shared/types/mcp'
import type { ModelConfig } from '@shared/types/provider'
import type { ModelMessage } from 'ai'
import {
  applyRequestParameterPolicy,
  isMiniMaxM3AdaptiveThinkingModel,
  type ModelRequestPolicy
} from '@shared/modelRequestPolicy'
import {
  getReasoningEffectiveEnabledForProvider,
  hasAnthropicReasoningToggle,
  normalizeAnthropicReasoningVisibilityValue,
  normalizeReasoningEffortValue,
  type ReasoningPortrait
} from '@shared/types/model-db'
import {
  OPENAI_COMPATIBLE_PROMPT_CACHE_MARKER,
  type OpenAICompatiblePromptCacheMarker,
  type PromptCacheIntent,
  resolvePromptCachePlan
} from '../promptCacheStrategy'
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
  requestPolicy: ModelRequestPolicy
  reasoningPortrait: ReasoningPortrait | null
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
  const normalizedModelId = modelId.trim().toLowerCase()
  const unqualifiedModelId = normalizedModelId.includes('/')
    ? normalizedModelId.slice(normalizedModelId.lastIndexOf('/') + 1)
    : normalizedModelId
  return unqualifiedModelId === 'grok-3-mini' || unqualifiedModelId.startsWith('grok-3-mini-')
}

function supportsMiniMaxAdaptiveThinking(
  providerId: string,
  capabilityProviderId: string,
  modelId: string
): boolean {
  return (
    isMiniMaxM3AdaptiveThinkingModel(providerId, modelId) ||
    isMiniMaxM3AdaptiveThinkingModel(capabilityProviderId, modelId)
  )
}

export function buildProviderOptions(
  params: BuildProviderOptionsParams
): ProviderOptionsMappingResult {
  const providerOptions: ProviderOptionsRecord = {}
  let messages = params.messages
  const requestPolicy = params.requestPolicy
  const modelConfig = params.modelConfig
  const reasoningPortrait = params.reasoningPortrait
  const reasoningEnabled = getReasoningEffectiveEnabledForProvider(
    params.capabilityProviderId,
    reasoningPortrait,
    {
      reasoning: applyRequestParameterPolicy(requestPolicy.reasoning, modelConfig.reasoning),
      reasoningEffort: modelConfig.reasoningEffort
    }
  )
  const hasThinkingConfig =
    modelConfig.thinkingBudget !== undefined || Boolean(modelConfig.reasoningEffort)
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
    conversationId: modelConfig.conversationId
  })

  switch (params.apiType) {
    case 'openai_chat':
    case 'openai_responses': {
      const config: Record<string, unknown> = {}
      if (
        modelConfig.reasoningEffort &&
        (params.providerId !== 'grok' || supportsGrokReasoningEffort(params.modelId))
      ) {
        config.reasoningEffort = modelConfig.reasoningEffort
      }
      if (modelConfig.verbosity) {
        config.textVerbosity = modelConfig.verbosity
      }
      if (modelConfig.maxCompletionTokens) {
        config.maxCompletionTokens = modelConfig.maxCompletionTokens
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
      if (requestPolicy.legacyThinking.mode === 'fixed') {
        config.thinking = {
          type: requestPolicy.legacyThinking.value
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
      if (params.providerId === 'dashscope' && reasoningEnabled) {
        const supportsThinking = reasoningPortrait?.supported === true
        if (supportsThinking) {
          config.enable_thinking = true
        }
        const budget =
          typeof modelConfig.thinkingBudget === 'number' && reasoningPortrait?.supported !== false
            ? modelConfig.thinkingBudget
            : supportsThinking
              ? reasoningPortrait.budget?.default
              : undefined
        if (typeof budget === 'number') {
          config.thinking_budget = budget
        }
      }
      if (Object.keys(config).length > 0) {
        providerOptions[params.providerOptionsKey] = config
      }
      break
    }

    case 'azure_responses': {
      const config: Record<string, unknown> = {}
      if (modelConfig.reasoningEffort) {
        config.reasoningEffort = modelConfig.reasoningEffort
      }
      if (modelConfig.verbosity) {
        config.textVerbosity = modelConfig.verbosity
      }
      if (modelConfig.maxCompletionTokens) {
        config.maxCompletionTokens = modelConfig.maxCompletionTokens
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
          normalizeReasoningEffortValue(reasoningPortrait, modelConfig.reasoningEffort) ??
          normalizeReasoningEffortValue(reasoningPortrait, reasoningPortrait?.effort)
        const resolvedVisibility =
          normalizeAnthropicReasoningVisibilityValue(modelConfig.reasoningVisibility) ??
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
      } else if (reasoningEnabled && modelConfig.thinkingBudget !== undefined) {
        config.thinking = {
          type: 'enabled',
          budgetTokens: modelConfig.thinkingBudget
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
      if (reasoningEnabled && modelConfig.thinkingBudget !== undefined) {
        config.reasoningConfig = {
          type: 'enabled',
          budgetTokens: modelConfig.thinkingBudget
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
          ...(modelConfig.thinkingBudget !== undefined
            ? { thinkingBudget: modelConfig.thinkingBudget }
            : {}),
          ...(modelConfig.reasoningEffort ? { thinkingLevel: modelConfig.reasoningEffort } : {}),
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
          ...(modelConfig.thinkingBudget !== undefined
            ? { thinkingBudget: modelConfig.thinkingBudget }
            : {}),
          ...(modelConfig.reasoningEffort ? { thinkingLevel: modelConfig.reasoningEffort } : {}),
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
