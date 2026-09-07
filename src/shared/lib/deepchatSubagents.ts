import type {
  AgentType,
  DeepChatAgentConfig,
  DeepChatSubagentCapability,
  DeepChatSubagentSlot,
  SessionKind
} from '@shared/types/agent-interface'
import { UNTRUSTED_CHILD_OUTPUT_POLICY } from '@shared/orchestration/resultSafety'

export const DEEPCHAT_SUBAGENT_SLOT_LIMIT = 5
export const DEEPCHAT_SUBAGENT_TASK_TITLE_LIMIT = 80
export const DEEPCHAT_SELF_SUBAGENT_SLOT_ID = 'self'
export const DEEPCHAT_EXPLORER_SUBAGENT_SLOT_ID = 'explorer'
export const DEEPCHAT_IMPLEMENTER_SUBAGENT_SLOT_ID = 'implementer'
export const DEEPCHAT_REVIEWER_SUBAGENT_SLOT_ID = 'reviewer'

export type { DeepChatSubagentCapability } from '@shared/types/agent-interface'

export const DEEPCHAT_SUBAGENT_MODEL_GUIDANCE = [
  'Honor explicit user requests about Subagents: use them when requested and available, and never use them for a request that asks you not to.',
  "Tool availability never overrides the current session's explicit or proactive orchestration policy.",
  'For proactive delegation, choose only work with clear independent, isolated, or parallel benefit.',
  'Do not proactively delegate simple, latency-sensitive, or strongly sequential tasks.',
  'Do not run write-heavy Subagents in parallel when their files may overlap.',
  `Name each spawned task with a concise user-language action-and-scope title of at most ${DEEPCHAT_SUBAGENT_TASK_TITLE_LIMIT} characters; keep sibling titles distinct and do not use role-only, ordinal, or person-like names.`,
  'Use bounded task prompts and require concrete evidence or validation from each child.',
  UNTRUSTED_CHILD_OUTPUT_POLICY,
  'Use a child Handoff by default; call read_result only when the complete referenced answer is needed.',
  'Account for every spawned child until it reaches a terminal state; do not interrupt merely to avoid waiting, and interrupt only when the user requests it or the task is definitively superseded.',
  'Delegation adds token usage, latency, and system resource cost.'
].join(' ')

export interface ResolveDeepChatSubagentCapabilityInput {
  agentType: AgentType | null
  sessionKind: SessionKind | null | undefined
  agentPolicyEnabled: boolean
  slots?: DeepChatSubagentSlot[] | null
}

export const createDefaultDeepChatSelfSubagentSlot = (): DeepChatSubagentSlot => ({
  id: DEEPCHAT_SELF_SUBAGENT_SLOT_ID,
  targetType: 'self',
  displayName: 'Self Clone',
  description: 'Inherit the current parent session agent logic with an isolated context.'
})

export const createDefaultDeepChatSubagentSlots = (): DeepChatSubagentSlot[] => [
  {
    id: DEEPCHAT_EXPLORER_SUBAGENT_SLOT_ID,
    targetType: 'self',
    displayName: 'Explorer',
    description: 'Investigate code, requirements, or evidence in an isolated context.'
  },
  {
    id: DEEPCHAT_IMPLEMENTER_SUBAGENT_SLOT_ID,
    targetType: 'self',
    displayName: 'Implementer',
    description: 'Implement a bounded code or content change in an isolated context.'
  },
  {
    id: DEEPCHAT_REVIEWER_SUBAGENT_SLOT_ID,
    targetType: 'self',
    displayName: 'Reviewer',
    description: 'Review changes, risks, and verification gaps in an isolated context.'
  }
]

const normalizeDisplayName = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}

const normalizeDescription = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}

export const normalizeDeepChatSubagentSlots = (
  slots?: DeepChatSubagentSlot[] | null
): DeepChatSubagentSlot[] => {
  const normalized: DeepChatSubagentSlot[] = []
  const seenIds = new Set<string>()

  const pushSlot = (slot: DeepChatSubagentSlot) => {
    if (normalized.length >= DEEPCHAT_SUBAGENT_SLOT_LIMIT) {
      return
    }

    const normalizedId = slot.id.trim()
    if (!normalizedId || seenIds.has(normalizedId)) {
      return
    }

    seenIds.add(normalizedId)
    normalized.push(slot)
  }

  for (const slot of Array.isArray(slots) ? slots : []) {
    if (!slot || typeof slot !== 'object') {
      continue
    }

    const id = typeof slot.id === 'string' ? slot.id.trim() : ''
    if (!id) {
      continue
    }

    if (slot.targetType === 'self') {
      pushSlot({
        id,
        targetType: 'self',
        displayName: normalizeDisplayName(
          typeof slot.displayName === 'string' ? slot.displayName : undefined,
          'Self Clone'
        ),
        description: normalizeDescription(
          typeof slot.description === 'string' ? slot.description : undefined,
          ''
        )
      })
      continue
    }

    if (slot.targetType !== 'agent') {
      continue
    }

    const targetAgentId = typeof slot.targetAgentId === 'string' ? slot.targetAgentId.trim() : ''
    if (!targetAgentId) {
      continue
    }

    pushSlot({
      id,
      targetType: 'agent',
      targetAgentId,
      displayName: normalizeDisplayName(
        typeof slot.displayName === 'string' ? slot.displayName : undefined,
        targetAgentId
      ),
      description: normalizeDescription(
        typeof slot.description === 'string' ? slot.description : undefined,
        ''
      )
    })
  }

  return normalized
}

const compareSubagentSlots = (left: DeepChatSubagentSlot, right: DeepChatSubagentSlot): number =>
  left.id.localeCompare(right.id) ||
  left.targetType.localeCompare(right.targetType) ||
  (left.targetAgentId ?? '').localeCompare(right.targetAgentId ?? '') ||
  left.displayName.localeCompare(right.displayName) ||
  left.description.localeCompare(right.description)

const createUnavailableSubagentCapability = (
  reason: Extract<DeepChatSubagentCapability, { available: false }>['reason']
): DeepChatSubagentCapability => {
  const cacheKey = JSON.stringify({ available: false, reason })
  return { available: false, reason, cacheKey }
}

export const resolveDeepChatSubagentCapability = (
  input: ResolveDeepChatSubagentCapabilityInput
): DeepChatSubagentCapability => {
  if (input.agentType !== 'deepchat' || input.sessionKind !== 'regular') {
    return createUnavailableSubagentCapability('unsupported_session')
  }

  if (input.agentPolicyEnabled === false) {
    return createUnavailableSubagentCapability('policy_disabled')
  }

  const slots = normalizeDeepChatSubagentSlots(input.slots).sort(compareSubagentSlots)
  if (slots.length === 0) {
    return createUnavailableSubagentCapability('no_valid_slots')
  }

  const cacheKey = JSON.stringify({ available: true, slots })
  return { available: true, slots, cacheKey }
}

export const normalizeDeepChatSubagentConfig = (
  config?: DeepChatAgentConfig | null
): DeepChatAgentConfig => {
  const hasConfiguredSlots = config?.subagents !== undefined && config.subagents !== null

  return {
    ...config,
    subagentEnabled: config?.subagentEnabled !== false,
    subagents: hasConfiguredSlots
      ? normalizeDeepChatSubagentSlots(config?.subagents)
      : createDefaultDeepChatSubagentSlots()
  }
}

export const assertDeepChatSubagentConfigInvariant = (config: DeepChatAgentConfig): void => {
  const normalized = normalizeDeepChatSubagentConfig(config)
  if (normalized.subagentEnabled !== false && (normalized.subagents?.length ?? 0) === 0) {
    throw new Error('Enabled DeepChat Subagents require at least one valid slot.')
  }
}
