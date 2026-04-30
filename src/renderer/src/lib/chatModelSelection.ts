import type { RENDERER_MODEL_META } from '@shared/presenter'

export type ChatModelSelection = {
  providerId: string
  modelId?: string | null
}

export type ChatSelectableModelGroup = {
  providerId: string
  models: RENDERER_MODEL_META[]
}

export type ResolvedChatModel = {
  providerId: string
  model: RENDERER_MODEL_META
}

const getEligibleModels = (
  group: ChatSelectableModelGroup | undefined,
  requiresVision: boolean
): RENDERER_MODEL_META[] => {
  if (!group) {
    return []
  }

  return requiresVision ? group.models.filter((model) => model.vision) : group.models
}

export const pickFirstChatModel = (
  modelGroups: ChatSelectableModelGroup[],
  requiresVision = false
): ResolvedChatModel | null => {
  for (const group of modelGroups) {
    const [firstModel] = getEligibleModels(group, requiresVision)
    if (firstModel) {
      return { providerId: group.providerId, model: firstModel }
    }
  }

  return null
}

export const resolvePreferredChatModel = (input: {
  modelGroups: ChatSelectableModelGroup[]
  selections: Array<ChatModelSelection | null | undefined>
}): ResolvedChatModel | null => {
  for (const selection of input.selections) {
    if (!selection?.providerId || !selection.modelId) {
      continue
    }

    const group = input.modelGroups.find((entry) => entry.providerId === selection.providerId)
    const model = group?.models.find((entry) => entry.id === selection.modelId)
    if (group && model) {
      return { providerId: group.providerId, model }
    }
  }

  return pickFirstChatModel(input.modelGroups)
}

export const resolveSamplingChatModel = (input: {
  modelGroups: ChatSelectableModelGroup[]
  requiresVision: boolean
  selections: Array<ChatModelSelection | null | undefined>
}): ResolvedChatModel | null => {
  for (const selection of input.selections) {
    if (!selection?.providerId) {
      continue
    }

    const group = input.modelGroups.find((entry) => entry.providerId === selection.providerId)
    const models = getEligibleModels(group, input.requiresVision)
    if (models.length === 0) {
      continue
    }

    if (selection.modelId) {
      const preferredModel = models.find((model) => model.id === selection.modelId)
      if (preferredModel) {
        return { providerId: selection.providerId, model: preferredModel }
      }
    }

    return { providerId: selection.providerId, model: models[0] }
  }

  return pickFirstChatModel(input.modelGroups, input.requiresVision)
}

export const resolveChatModelByQuery = (
  modelGroups: ChatSelectableModelGroup[],
  query: string | null | undefined
): ResolvedChatModel | null => {
  const normalizedQuery = query?.trim().toLowerCase()
  if (!normalizedQuery) {
    return null
  }

  for (const group of modelGroups) {
    const exactModel = group.models.find((model) => model.id.toLowerCase() === normalizedQuery)
    if (exactModel) {
      return { providerId: group.providerId, model: exactModel }
    }
  }

  for (const group of modelGroups) {
    const fuzzyModel = group.models.find((model) =>
      model.id.toLowerCase().includes(normalizedQuery)
    )
    if (fuzzyModel) {
      return { providerId: group.providerId, model: fuzzyModel }
    }
  }

  return null
}
