import type { ChatMessage } from '@shared/types/core/chat-message'
import type { MCPToolDefinition } from '@shared/types/core/mcp'
import type {
  DeepChatPromptAssembly,
  DeepChatPromptSectionKind
} from '@shared/types/prompt-assembly'
import { estimateMessageTokens } from '@shared/utils/messageTokens'
import {
  estimateMessagesTokens,
  estimateToolDefinitionTokens,
  fitCacheAwareMessagesToContextWindow,
  fitMessagesToContextWindow
} from './contextBuilder'
import type { ContextRuntimeContributions } from './contextContributions'

export const AGENT_DEFAULT_MAX_OUTPUT_TOKENS_CAP = 16_384
export const AGENT_REQUEST_MAX_OUTPUT_TOKENS_CAP = 32_768
export const AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS = 1
export const AGENT_CONTEXT_SAFETY_MARGIN_TOKENS = 256
export const AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS = 4_000

export type RequestContextBudget = {
  outputReserveTokens: number
  toolReserveTokens: number
  totalReserveTokens: number
}

export type RequestContextPreflightResult = {
  messages: ChatMessage[]
  contextLength: number
  inputTokens: number
  toolReserveTokens: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  usableContextLength: number
  remainingOutputTokens: number
  totalRequestTokens: number
  fitsWithinContext: boolean
  shrunkByContextPressure: boolean
  requiresContextPressureRecovery: boolean
}

export type RequestContextBudgetDiagnostics = {
  usableContextLength: number
  inputTokens: number
  toolReserveTokens: number
  requestedMaxTokens: number
  effectiveMaxTokens: number
  remainingOutputTokens: number
  totalRequestTokens: number
}

export interface RequestContextLedgerContributor {
  name: string
  estimatedTokens: number
}

export interface RequestContextLedgerItem {
  category: string
  estimatedTokens: number
  contributors?: readonly RequestContextLedgerContributor[]
}

export interface RequestContextLedger {
  attribution: 'available' | 'opaque_system_prompt'
  items: readonly RequestContextLedgerItem[]
  unattributedInputTokens: number
}

export interface RequestContextLedgerSkill {
  scope: 'message' | 'session'
  name: string
  effectiveContent: string
}

export interface RequestContextLedgerRuntimeSkill {
  name: string
  toolCallId: string
}

const MAX_LEDGER_SKILL_CONTRIBUTORS = 8
const PROMPT_SECTION_LEDGER_CATEGORIES: Record<DeepChatPromptSectionKind, string> = {
  configured_prompt: 'Configured prompt',
  runtime_capabilities: 'Runtime capabilities',
  system_environment: 'System environment',
  agents_instructions: 'Project instructions',
  skills_metadata: 'Skill catalog',
  pinned_skills: 'Session Skills',
  tooling: 'Tool instructions',
  orchestration_policy: 'Orchestration policy',
  permission_rules: 'Permission rules',
  verification_policy: 'Verification policy',
  attachment_safety: 'Attachment safety',
  effective_system_prompt: 'System prompt (attribution unavailable)'
}

export function estimateToolReserveTokens(tools: MCPToolDefinition[]): number {
  return estimateToolDefinitionTokens(tools)
}

export function getUsableContextLength(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return contextLength
  }

  // Tiny synthetic windows are used heavily in tests; reserving 256 there would leave no usable
  // room and would not represent a real agent model window.
  if (contextLength <= AGENT_CONTEXT_SAFETY_MARGIN_TOKENS * 4) {
    return contextLength
  }

  return Math.max(
    AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS,
    Math.floor(contextLength - AGENT_CONTEXT_SAFETY_MARGIN_TOKENS)
  )
}

export function capAgentRequestMaxTokens(
  maxTokens: number,
  contextLength: number = Number.MAX_SAFE_INTEGER
): number {
  const normalizedMaxTokens = Number.isFinite(maxTokens)
    ? Math.floor(maxTokens)
    : AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  const requested = Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, normalizedMaxTokens)

  return Math.max(
    AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS,
    Math.min(requested, AGENT_REQUEST_MAX_OUTPUT_TOKENS_CAP, getContextOutputCap(contextLength))
  )
}

export function capAgentDefaultMaxTokens(maxTokens: number, contextLength: number): number {
  return Math.min(
    capAgentRequestMaxTokens(maxTokens, contextLength),
    AGENT_DEFAULT_MAX_OUTPUT_TOKENS_CAP
  )
}

export function resolveEffectiveContextBudget(input: {
  configuredContextLength: number
  requestedMaxTokens: number
  runtimeContextLimitTokens?: number
  providerContextLimitTokens?: number
  providerPromptLimitTokens?: number
}): { contextLength: number; outputCapContextLength: number } {
  const configuredContextLength = input.configuredContextLength
  const totalContextLimits: number[] = []
  if (Number.isFinite(configuredContextLength) && configuredContextLength > 0) {
    totalContextLimits.push(configuredContextLength)
  }
  for (const contextLimit of [
    input.runtimeContextLimitTokens,
    input.providerContextLimitTokens
  ]) {
    if (
      typeof contextLimit === 'number' &&
      Number.isSafeInteger(contextLimit) &&
      contextLimit > 0
    ) {
      totalContextLimits.push(contextLimit)
    }
  }
  const outputCapContextLength =
    totalContextLimits.length > 0 ? Math.min(...totalContextLimits) : configuredContextLength
  let contextLength = outputCapContextLength
  const providerPromptLimitTokens = input.providerPromptLimitTokens
  if (
    typeof providerPromptLimitTokens === 'number' &&
    Number.isSafeInteger(providerPromptLimitTokens) &&
    providerPromptLimitTokens > 0
  ) {
    const outputReserve = capAgentRequestMaxTokens(
      input.requestedMaxTokens,
      outputCapContextLength
    )
    const promptBudgetLength = Math.min(
      Number.MAX_SAFE_INTEGER,
      providerPromptLimitTokens + outputReserve
    )
    contextLength =
      Number.isFinite(contextLength) && contextLength > 0
        ? Math.min(contextLength, promptBudgetLength)
        : promptBudgetLength
  }
  return { contextLength, outputCapContextLength }
}

export function buildRequestContextBudget(
  maxTokens: number,
  contextLength: number,
  tools: MCPToolDefinition[]
): RequestContextBudget {
  const outputReserveTokens = capAgentRequestMaxTokens(maxTokens, contextLength)
  const toolReserveTokens = estimateToolReserveTokens(tools)
  return {
    outputReserveTokens,
    toolReserveTokens,
    totalReserveTokens: outputReserveTokens + toolReserveTokens
  }
}

export function fitRequestMessagesToContextWindow(params: {
  messages: ChatMessage[]
  contextLength: number
  reserveTokens: number
  minimumProtectedTailCount?: number
  contextContributions?: ContextRuntimeContributions
  pinnedFirstUserContentHash?: string
}): ChatMessage[] {
  if (params.pinnedFirstUserContentHash && !params.contextContributions) {
    throw new TypeError('Pinned first-user fitting requires cache-aware context contributions.')
  }
  if (!Number.isFinite(params.contextLength) || params.contextLength <= 0) {
    return params.messages
  }

  const usableContextLength = getUsableContextLength(params.contextLength)
  if (params.contextContributions) {
    return fitCacheAwareMessagesToContextWindow(
      params.messages,
      usableContextLength,
      params.reserveTokens,
      params.contextContributions,
      params.minimumProtectedTailCount ?? 0,
      params.pinnedFirstUserContentHash
    )
  }

  return fitMessagesToContextWindow(
    params.messages,
    usableContextLength,
    params.reserveTokens,
    Math.max(
      params.minimumProtectedTailCount ?? 0,
      resolveProtectedRequestTailCount(params.messages)
    )
  )
}

export function resolveEffectiveRequestMaxTokens(params: {
  messages: ChatMessage[]
  toolReserveTokens: number
  contextLength: number
  requestedMaxTokens: number
}): number {
  const requested = capAgentRequestMaxTokens(params.requestedMaxTokens, params.contextLength)
  if (!Number.isFinite(params.contextLength) || params.contextLength <= 0) {
    return requested
  }

  const remaining = Math.floor(
    getUsableContextLength(params.contextLength) -
      estimateMessagesTokens(params.messages) -
      params.toolReserveTokens
  )
  if (remaining <= 0) {
    return AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.min(requested, remaining))
}

export function preflightRequestContext(params: {
  messages: ChatMessage[]
  tools: MCPToolDefinition[]
  contextLength: number
  outputCapContextLength?: number
  requestedMaxTokens: number
  minimumProtectedTailCount?: number
  contextContributions?: ContextRuntimeContributions
  pinnedFirstUserContentHash?: string
  promptTokenEstimate?: number
}): RequestContextPreflightResult {
  const requestedMaxTokens = capAgentRequestMaxTokens(
    params.requestedMaxTokens,
    params.outputCapContextLength ?? params.contextLength
  )
  const toolReserveTokens = estimateToolReserveTokens(params.tools)
  const usableContextLength = getUsableContextLength(params.contextLength)
  const sanitizedCandidate = sanitizeToolContinuationMessages(params.messages)
  const sanitizedCandidateMatchesInput =
    sanitizedCandidate.length === params.messages.length &&
    sanitizedCandidate.every((message, index) => message === params.messages[index])
  const anchoredPromptEstimate =
    typeof params.promptTokenEstimate === 'number' &&
    Number.isSafeInteger(params.promptTokenEstimate) &&
    params.promptTokenEstimate >= 0
      ? params.promptTokenEstimate
      : null
  const validCandidatePromptEstimate =
    sanitizedCandidateMatchesInput ? anchoredPromptEstimate : null
  const hasFiniteContext =
    Number.isFinite(usableContextLength) &&
    Number.isFinite(params.contextLength) &&
    params.contextLength > 0 &&
    usableContextLength > 0
  const anchoredCandidateInputTokens =
    validCandidatePromptEstimate === null
      ? null
      : Math.max(0, validCandidatePromptEstimate - toolReserveTokens)
  const anchoredCandidateFits =
    anchoredCandidateInputTokens !== null &&
    (!hasFiniteContext ||
      usableContextLength - anchoredCandidateInputTokens - toolReserveTokens >= 1)
  const fittedMessages = anchoredCandidateFits
    ? sanitizedCandidate
    : sanitizeToolContinuationMessages(
        fitRequestMessagesToContextWindow({
          messages: sanitizedCandidate,
          contextLength: params.contextLength,
          reserveTokens: requestedMaxTokens + toolReserveTokens,
          minimumProtectedTailCount: params.minimumProtectedTailCount,
          contextContributions: params.contextContributions,
          pinnedFirstUserContentHash: params.pinnedFirstUserContentHash
        })
      )
  const fittedMatchesCandidate =
    fittedMessages.length === params.messages.length &&
    fittedMessages.every((message, index) => message === params.messages[index])
  const validPromptTokenEstimate =
    fittedMatchesCandidate ? anchoredPromptEstimate : null
  const inputTokens =
    validPromptTokenEstimate === null
      ? estimateMessagesTokens(fittedMessages)
      : Math.max(0, validPromptTokenEstimate - toolReserveTokens)
  const remainingOutputTokens = hasFiniteContext
    ? Math.floor(usableContextLength - inputTokens - toolReserveTokens)
    : requestedMaxTokens
  const fitsWithinContext =
    !hasFiniteContext || remainingOutputTokens >= AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS
  const effectiveMaxTokens = hasFiniteContext
    ? remainingOutputTokens <= 0
      ? 0
      : Math.max(
          AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS,
          Math.min(requestedMaxTokens, remainingOutputTokens)
        )
    : requestedMaxTokens
  const totalRequestTokens = inputTokens + toolReserveTokens + effectiveMaxTokens
  const shrunkByContextPressure = effectiveMaxTokens < requestedMaxTokens
  const requiresContextPressureRecovery =
    shrunkByContextPressure &&
    requestedMaxTokens >= AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS &&
    effectiveMaxTokens < AGENT_CONTEXT_PRESSURE_MIN_OUTPUT_TOKENS

  return {
    messages: fittedMessages,
    contextLength: params.contextLength,
    inputTokens,
    toolReserveTokens,
    requestedMaxTokens,
    effectiveMaxTokens,
    usableContextLength,
    remainingOutputTokens,
    totalRequestTokens,
    fitsWithinContext,
    shrunkByContextPressure,
    requiresContextPressureRecovery
  }
}

export function buildRequestContextBudgetDiagnostics(
  preflight: RequestContextPreflightResult
): RequestContextBudgetDiagnostics {
  return {
    usableContextLength: preflight.usableContextLength,
    inputTokens: preflight.inputTokens,
    toolReserveTokens: preflight.toolReserveTokens,
    requestedMaxTokens: preflight.requestedMaxTokens,
    effectiveMaxTokens: preflight.effectiveMaxTokens,
    remainingOutputTokens: preflight.remainingOutputTokens,
    totalRequestTokens: preflight.totalRequestTokens
  }
}

function addLedgerCost(costs: Map<string, number>, category: string, estimatedTokens: number): number {
  if (!Number.isFinite(estimatedTokens) || estimatedTokens <= 0) return 0
  const normalizedTokens = Math.floor(estimatedTokens)
  costs.set(category, (costs.get(category) ?? 0) + normalizedTokens)
  return normalizedTokens
}

function estimateStandaloneText(content: string): number {
  return estimateMessageTokens({ role: 'user', content })
}

function buildSkillContributors(
  skills: readonly RequestContextLedgerSkill[],
  scope: RequestContextLedgerSkill['scope']
): readonly RequestContextLedgerContributor[] | undefined {
  const contributors = skills
    .filter((skill) => skill.scope === scope)
    .map((skill) => ({
      name: skill.name,
      estimatedTokens: estimateStandaloneText(skill.effectiveContent)
    }))
    .sort(
      (left, right) =>
        right.estimatedTokens - left.estimatedTokens || left.name.localeCompare(right.name)
    )
    .slice(0, MAX_LEDGER_SKILL_CONTRIBUTORS)
  return contributors.length > 0 ? contributors : undefined
}

export function buildRequestContextLedger(input: {
  preflight: RequestContextPreflightResult
  promptAssembly?: DeepChatPromptAssembly
  contextContributions?: ContextRuntimeContributions
  skills?: readonly RequestContextLedgerSkill[]
  runtimeSkills?: readonly RequestContextLedgerRuntimeSkill[]
}): RequestContextLedger {
  const costs = new Map<string, number>()
  const messages = input.preflight.messages
  const leadingSystem = messages[0]?.role === 'system' ? messages[0] : undefined
  const leadingSystemContent =
    leadingSystem && typeof leadingSystem.content === 'string' ? leadingSystem.content : ''
  let attributedInputTokens = 0
  let attribution: RequestContextLedger['attribution'] = 'available'

  if (leadingSystem) {
    const systemTokens = estimateMessageTokens(leadingSystem)
    if (input.promptAssembly?.prompt === leadingSystemContent) {
      let projectedPrompt = ''
      let previousTokens = 0
      for (const section of input.promptAssembly.sections) {
        if (!section.content.trim()) continue
        projectedPrompt = projectedPrompt
          ? `${projectedPrompt}${section.separatorBefore ?? '\n\n'}${section.content}`
          : section.content
        const projectedTokens = estimateStandaloneText(projectedPrompt)
        attributedInputTokens += addLedgerCost(
          costs,
          PROMPT_SECTION_LEDGER_CATEGORIES[section.kind],
          Math.max(0, projectedTokens - previousTokens)
        )
        previousTokens = projectedTokens
      }
      if (previousTokens < systemTokens) {
        attributedInputTokens += addLedgerCost(
          costs,
          'Unattributed system prompt',
          systemTokens - previousTokens
        )
      }
    } else {
      attribution = 'opaque_system_prompt'
      attributedInputTokens += addLedgerCost(
        costs,
        'System prompt (attribution unavailable)',
        systemTokens
      )
    }
  }

  const nonSystemMessages = leadingSystem ? messages.slice(1) : messages
  const currentUserIndex = messages.findLastIndex((message) => message.role === 'user')
  const runtimeSkillByToolCallId = new Map(
    (input.runtimeSkills ?? []).map((skill) => [skill.toolCallId, skill] as const)
  )
  const runtimeSkillContributors: RequestContextLedgerContributor[] = []
  const activeTurnContributions = [
    {
      category: 'Memory',
      content:
        input.contextContributions?.memoryIncluded === true
          ? input.contextContributions.memory.content
          : null
    },
    {
      category: 'User directives',
      content:
        input.contextContributions?.directivesIncluded === true
          ? input.contextContributions.directives.content
          : null
    },
    {
      category: 'Message Skills',
      content: input.contextContributions?.messageSkillActiveTurnContext ?? null
    }
  ] as const

  for (const [relativeIndex, message] of nonSystemMessages.entries()) {
    const absoluteIndex = relativeIndex + (leadingSystem ? 1 : 0)
    const messageTokens = estimateMessageTokens(message)
    const runtimeSkill =
      message.role === 'tool' && message.tool_call_id
        ? runtimeSkillByToolCallId.get(message.tool_call_id)
        : undefined
    if (runtimeSkill) {
      attributedInputTokens += addLedgerCost(costs, 'Message Skills', messageTokens)
      runtimeSkillContributors.push({
        name: runtimeSkill.name,
        estimatedTokens: messageTokens
      })
      continue
    }
    let remainingTokens = messageTokens
    if (absoluteIndex === currentUserIndex) {
      for (const contribution of activeTurnContributions) {
        if (!contribution.content) continue
        const contributionTokens = Math.min(
          remainingTokens,
          estimateStandaloneText(contribution.content)
        )
        attributedInputTokens += addLedgerCost(
          costs,
          contribution.category,
          contributionTokens
        )
        remainingTokens -= contributionTokens
      }
    }
    attributedInputTokens += addLedgerCost(
      costs,
      absoluteIndex === currentUserIndex ? 'Current input' : 'History and tool protocol',
      remainingTokens
    )
  }

  addLedgerCost(costs, 'Tool schemas', input.preflight.toolReserveTokens)
  addLedgerCost(costs, 'Output reserve', input.preflight.effectiveMaxTokens)
  const skills = input.skills ?? []
  const sessionContributors = buildSkillContributors(skills, 'session')
  const combinedMessageContributors = [
    ...(buildSkillContributors(skills, 'message') ?? []),
    ...runtimeSkillContributors
  ]
    .sort(
      (left, right) =>
        right.estimatedTokens - left.estimatedTokens || left.name.localeCompare(right.name)
    )
    .slice(0, MAX_LEDGER_SKILL_CONTRIBUTORS)
  const messageContributors =
    combinedMessageContributors.length > 0 ? combinedMessageContributors : undefined
  const items = [...costs.entries()].map(([category, estimatedTokens]) => ({
    category,
    estimatedTokens,
    ...(category === 'Session Skills' && sessionContributors
      ? { contributors: sessionContributors }
      : {}),
    ...(category === 'Message Skills' && messageContributors
      ? { contributors: messageContributors }
      : {})
  }))
  if (sessionContributors && !costs.has('Session Skills')) {
    items.push({
      category: 'Session Skills',
      estimatedTokens: 0,
      contributors: sessionContributors
    })
  }

  return {
    attribution,
    items,
    unattributedInputTokens: Math.max(0, input.preflight.inputTokens - attributedInputTokens)
  }
}

export function formatRequestContextLedger(ledger: RequestContextLedger): string {
  const lines = [
    'Approximate context ledger for this request (derived at failure time; not persisted):'
  ]
  for (const item of ledger.items) {
    const contributors = item.contributors?.length
      ? ` (${item.contributors
          .map((contributor) => {
            const safeName = Array.from(
              contributor.name.replace(/[\p{Cc}\p{Cf}]+/gu, ' ').trim()
            )
              .slice(0, 128)
              .join('')
            return `${safeName || 'unnamed'} ~${contributor.estimatedTokens}`
          })
          .join(', ')})`
      : ''
    lines.push(`- ${item.category}: ~${item.estimatedTokens} tokens${contributors}`)
  }
  if (ledger.unattributedInputTokens > 0) {
    lines.push(`- Unattributed input: ~${ledger.unattributedInputTokens} tokens`)
  }
  return lines.join('\n')
}

export function buildRequestContextOverflowErrorMessage(
  preflight: RequestContextPreflightResult,
  ledger?: RequestContextLedger
): string {
  const diagnostics = buildRequestContextBudgetDiagnostics(preflight)
  const formatTokenCount = (value: number): string =>
    Number.isFinite(value) ? String(Math.floor(value)) : 'unknown'

  const guidance = [
    'Request was not sent because it cannot fit within the model context window after applying the safety margin.',
    `Budget: usable context ${formatTokenCount(diagnostics.usableContextLength)} tokens, estimated input ${formatTokenCount(diagnostics.inputTokens)} tokens, tool schemas ${formatTokenCount(diagnostics.toolReserveTokens)} tokens, requested output ${formatTokenCount(diagnostics.requestedMaxTokens)} tokens, effective output ${formatTokenCount(diagnostics.effectiveMaxTokens)} tokens, remaining output room ${formatTokenCount(diagnostics.remainingOutputTokens)} tokens.`,
    ...(ledger ? [formatRequestContextLedger(ledger)] : []),
    'Try shortening the latest input or attachments, reducing active tools, skills, or system prompt content, lowering max output tokens, or increasing context length.'
  ]
  if (ledger?.items.some((item) => item.category === 'Session Skills')) {
    guidance.push(
      'Persistent Session Skills can be removed from the Session Skills control above the composer.'
    )
  }
  return guidance.join('\n')
}

function resolveProtectedRequestTailCount(messages: ChatMessage[]): number {
  if (messages.length === 0) {
    return 0
  }

  if (messages[messages.length - 1]?.role === 'user') {
    return 1
  }

  let activeTurnStart = messages.length - 1
  while (activeTurnStart > 0 && messages[activeTurnStart]?.role !== 'user') {
    activeTurnStart -= 1
  }
  if (messages.slice(activeTurnStart).some((message) => message.provider_replay)) {
    return messages.length - activeTurnStart
  }

  let toolTailStart = messages.length - 1
  while (toolTailStart >= 0 && messages[toolTailStart]?.role === 'tool') {
    toolTailStart -= 1
  }

  if (
    toolTailStart < messages.length - 1 &&
    messages[toolTailStart]?.role === 'assistant' &&
    Array.isArray(messages[toolTailStart]?.tool_calls) &&
    messages[toolTailStart]?.tool_calls?.length
  ) {
    return messages.length - toolTailStart
  }

  return 1
}

function sanitizeToolContinuationMessages(messages: ChatMessage[]): ChatMessage[] {
  const sanitized: ChatMessage[] = []
  let pendingToolCallIds = new Set<string>()

  for (const message of messages) {
    if (message.role === 'assistant') {
      sanitized.push(message)
      pendingToolCallIds = new Set(message.tool_calls?.map((toolCall) => toolCall.id) ?? [])
      continue
    }

    if (message.role === 'tool') {
      const toolCallId = message.tool_call_id
      if (!toolCallId) {
        if (pendingToolCallIds.size === 0) {
          continue
        }
        sanitized.push(message)
        continue
      }

      if (!pendingToolCallIds.has(toolCallId)) {
        continue
      }

      sanitized.push(message)
      pendingToolCallIds.delete(toolCallId)
      continue
    }

    sanitized.push(message)
    pendingToolCallIds = new Set()
  }

  return sanitized
}

function getContextOutputCap(contextLength: number): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0) {
    return Number.MAX_SAFE_INTEGER
  }

  return Math.max(AGENT_MIN_EFFECTIVE_OUTPUT_TOKENS, Math.floor(contextLength / 2))
}
