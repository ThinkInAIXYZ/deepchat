import type { DeepChatAgentConfig, DeepChatSubagentSlot } from '@shared/types/agent-interface'

export const DEEPCHAT_SUBAGENT_SLOT_LIMIT = 5
export const DEEPCHAT_SELF_SUBAGENT_SLOT_ID = 'self'

export const createDefaultDeepChatSelfSubagentSlot = (): DeepChatSubagentSlot => ({
  id: DEEPCHAT_SELF_SUBAGENT_SLOT_ID,
  targetType: 'self',
  displayName: 'Self Clone',
  description: 'Inherit the current parent session agent logic with an isolated context.'
})

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
          'Inherit the current parent session agent logic with an isolated context.'
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

  if (!normalized.some((slot) => slot.targetType === 'self')) {
    pushSlot(createDefaultDeepChatSelfSubagentSlot())
  }

  return normalized
}

export const normalizeDeepChatSubagentConfig = (
  config?: DeepChatAgentConfig | null
): DeepChatAgentConfig => ({
  ...config,
  subagentEnabled: config?.subagentEnabled === true,
  subagents: normalizeDeepChatSubagentSlots(config?.subagents)
})
