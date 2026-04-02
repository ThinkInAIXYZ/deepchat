import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { ChatCompletionContentPart, ChatCompletionMessageParam } from 'openai/resources'
import type { MCPToolDefinition } from '@shared/presenter'
import { resolvePromptCacheMode, type PromptCacheMode } from './promptCacheCapabilities'

export type PromptCacheApiType = 'openai_chat' | 'openai_responses' | 'anthropic'
export type PromptCacheTtl = '5m'

export interface PromptCacheBreakpointPlan {
  messageIndex: number
  contentIndex: number
}

export interface PromptCachePlan {
  mode: PromptCacheMode
  ttl: PromptCacheTtl | null
  cacheKey?: string
  breakpointPlan?: PromptCacheBreakpointPlan
}

export interface ResolvePromptCachePlanParams {
  providerId: string
  apiType: PromptCacheApiType
  modelId: string
  messages: unknown[]
  tools?: MCPToolDefinition[]
  conversationId?: string
}

type EphemeralCacheControl = { type: 'ephemeral' }

const EPHEMERAL_CACHE_CONTROL: EphemeralCacheControl = { type: 'ephemeral' }

type AnthropicTextBlockWithCache = Anthropic.TextBlockParam & {
  cache_control?: EphemeralCacheControl
}

function normalizeId(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

function buildPromptCacheKey(
  providerId: string,
  modelId: string,
  conversationId?: string
): string | undefined {
  const normalizedConversationId = conversationId?.trim()
  if (!normalizedConversationId) {
    return undefined
  }

  const digest = createHash('sha256')
    .update(`${normalizeId(providerId)}:${normalizeId(modelId)}:${normalizedConversationId}`)
    .digest('hex')
    .slice(0, 20)

  return `deepchat:${normalizeId(providerId)}:${normalizeId(modelId)}:${digest}`
}

function findOpenAIChatBreakpoint(
  messages: ChatCompletionMessageParam[]
): PromptCacheBreakpointPlan | undefined {
  let prefixEnd = messages.length

  while (prefixEnd > 0) {
    const role = messages[prefixEnd - 1]?.role
    if (role === 'user' || role === 'tool') {
      prefixEnd -= 1
      continue
    }
    break
  }

  for (let messageIndex = prefixEnd - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message || message.role === 'tool') {
      continue
    }

    const content = 'content' in message ? message.content : undefined
    if (typeof content === 'string') {
      if (content.trim()) {
        return { messageIndex, contentIndex: 0 }
      }
      continue
    }

    if (!Array.isArray(content)) {
      continue
    }

    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const part = content[contentIndex]
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        return { messageIndex, contentIndex }
      }
    }
  }

  return undefined
}

function findAnthropicBreakpoint(
  messages: Anthropic.MessageParam[]
): PromptCacheBreakpointPlan | undefined {
  let prefixEnd = messages.length

  while (prefixEnd > 0) {
    const role = messages[prefixEnd - 1]?.role
    if (role === 'user') {
      prefixEnd -= 1
      continue
    }
    break
  }

  for (let messageIndex = prefixEnd - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]
    if (!message) {
      continue
    }

    const content = message.content
    if (typeof content === 'string') {
      if (content.trim()) {
        return { messageIndex, contentIndex: 0 }
      }
      continue
    }

    if (!Array.isArray(content)) {
      continue
    }

    for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const block = content[contentIndex]
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return { messageIndex, contentIndex }
      }
    }
  }

  return undefined
}

export function resolvePromptCachePlan(params: ResolvePromptCachePlanParams): PromptCachePlan {
  const mode = resolvePromptCacheMode(params.providerId, params.modelId)

  if (mode === 'disabled') {
    return { mode, ttl: null }
  }

  if (mode === 'openai_implicit') {
    return {
      mode,
      ttl: null,
      cacheKey: buildPromptCacheKey(params.providerId, params.modelId, params.conversationId)
    }
  }

  if (mode === 'anthropic_auto') {
    return {
      mode,
      ttl: '5m'
    }
  }

  const breakpointPlan =
    params.apiType === 'anthropic'
      ? findAnthropicBreakpoint(params.messages as Anthropic.MessageParam[])
      : findOpenAIChatBreakpoint(params.messages as ChatCompletionMessageParam[])

  return {
    mode,
    ttl: '5m',
    breakpointPlan
  }
}

export function applyOpenAIPromptCacheKey<T extends Record<string, unknown>>(
  requestParams: T,
  plan: PromptCachePlan
): T {
  if (plan.mode !== 'openai_implicit' || !plan.cacheKey) {
    return requestParams
  }

  return {
    ...requestParams,
    prompt_cache_key: plan.cacheKey
  }
}

export function applyAnthropicTopLevelCacheControl<T extends Record<string, unknown>>(
  requestParams: T,
  plan: PromptCachePlan
): T {
  if (plan.mode !== 'anthropic_auto') {
    return requestParams
  }

  return {
    ...requestParams,
    cache_control: EPHEMERAL_CACHE_CONTROL
  }
}

export function applyOpenAIChatExplicitCacheBreakpoint(
  messages: ChatCompletionMessageParam[],
  plan: PromptCachePlan
): ChatCompletionMessageParam[] {
  if (plan.mode !== 'anthropic_explicit' || !plan.breakpointPlan) {
    return messages
  }

  const { messageIndex, contentIndex } = plan.breakpointPlan
  const target = messages[messageIndex]

  if (!target || !('content' in target)) {
    return messages
  }

  const content = target.content
  let nextContent: ChatCompletionMessageParam['content'] =
    content as ChatCompletionMessageParam['content']

  if (typeof content === 'string') {
    if (!content.trim() || contentIndex !== 0) {
      return messages
    }

    nextContent = [
      {
        type: 'text',
        text: content,
        cache_control: EPHEMERAL_CACHE_CONTROL
      } as unknown as ChatCompletionContentPart
    ]
  } else if (Array.isArray(content)) {
    nextContent = content.map((part, index) => {
      if (
        index !== contentIndex ||
        part?.type !== 'text' ||
        typeof part.text !== 'string' ||
        !part.text.trim()
      ) {
        return part
      }

      return {
        ...part,
        cache_control: EPHEMERAL_CACHE_CONTROL
      } as unknown as ChatCompletionContentPart
    }) as ChatCompletionMessageParam['content']
  } else {
    return messages
  }

  return messages.map((message, index) =>
    index === messageIndex
      ? ({
          ...message,
          content: nextContent
        } as ChatCompletionMessageParam)
      : message
  )
}

export function applyAnthropicExplicitCacheBreakpoint(
  messages: Anthropic.MessageParam[],
  plan: PromptCachePlan
): Anthropic.MessageParam[] {
  if (plan.mode !== 'anthropic_explicit' || !plan.breakpointPlan) {
    return messages
  }

  const { messageIndex, contentIndex } = plan.breakpointPlan
  const target = messages[messageIndex]

  if (!target) {
    return messages
  }

  const content = target.content
  let nextContent: Anthropic.MessageParam['content'] = content

  if (typeof content === 'string') {
    if (!content.trim() || contentIndex !== 0) {
      return messages
    }

    nextContent = [
      {
        type: 'text',
        text: content,
        cache_control: EPHEMERAL_CACHE_CONTROL
      } satisfies AnthropicTextBlockWithCache
    ]
  } else if (Array.isArray(content)) {
    nextContent = content.map((block, index) => {
      if (
        index !== contentIndex ||
        block?.type !== 'text' ||
        typeof block.text !== 'string' ||
        !block.text.trim()
      ) {
        return block
      }

      return {
        ...block,
        cache_control: EPHEMERAL_CACHE_CONTROL
      } satisfies AnthropicTextBlockWithCache
    })
  } else {
    return messages
  }

  return messages.map((message, index) =>
    index === messageIndex
      ? ({
          ...message,
          content: nextContent
        } as Anthropic.MessageParam)
      : message
  )
}
