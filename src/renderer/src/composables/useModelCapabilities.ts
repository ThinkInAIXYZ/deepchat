import { computed, ref, shallowRef, watch, type Ref } from 'vue'

import { createModelClient } from '@api/ModelClient'
import type { RequestParameterPolicy } from '@shared/modelRequestPolicy'
import type { CapabilitySnapshotQuery } from '@shared/types/model-capabilities'
import type { ReasoningPortrait } from '@shared/types/model-db'
import type { ThinkingBudgetRange } from './useThinkingBudget'

type ModelClient = ReturnType<typeof createModelClient>

export type RendererModelCapabilities = Awaited<ReturnType<ModelClient['getCapabilities']>>

export type CapabilityLoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type GenerationParameterControl =
  | { mode: 'hidden' }
  | { mode: 'editable' }
  | { mode: 'fixed'; value: number }
  | { mode: 'loading' }

export const resolveGenerationParameterControl = (
  policy: RequestParameterPolicy<number> | null | undefined,
  status: CapabilityLoadStatus
): GenerationParameterControl => {
  if (status === 'loading') {
    return { mode: 'loading' }
  }
  if (status !== 'ready') {
    return { mode: 'hidden' }
  }

  switch (policy?.mode) {
    case 'omit':
      return { mode: 'hidden' }
    case 'fixed':
      return { mode: 'fixed', value: policy.value }
    case 'passthrough':
    default:
      return { mode: 'editable' }
  }
}

const normalizeBudgetRange = (
  budget: ReasoningPortrait['budget'] | ThinkingBudgetRange | null | undefined
): ThinkingBudgetRange | null => {
  if (!budget) return null

  const range: ThinkingBudgetRange = {}
  if (typeof budget.min === 'number') range.min = budget.min
  if (typeof budget.max === 'number') range.max = budget.max
  if (typeof budget.default === 'number') range.default = budget.default
  if (typeof budget.auto === 'number') range.auto = budget.auto
  if (typeof budget.off === 'number') range.off = budget.off
  if (typeof budget.unit === 'string') range.unit = budget.unit

  return Object.keys(range).length > 0 ? range : null
}

const mergeBudgetRanges = (
  base: ReasoningPortrait['budget'] | ThinkingBudgetRange | null | undefined,
  overlay: ReasoningPortrait['budget'] | ThinkingBudgetRange | null | undefined
): ThinkingBudgetRange | null => {
  const normalizedBase = normalizeBudgetRange(base) ?? {}
  const normalizedOverlay = normalizeBudgetRange(overlay) ?? {}
  const merged = {
    ...normalizedBase,
    ...normalizedOverlay
  }

  return Object.keys(merged).length > 0 ? merged : null
}

export interface UseModelCapabilitiesOptions {
  providerId: Ref<string | undefined>
  modelId: Ref<string | undefined>
}

export type CapabilityQueryIdentity = Pick<CapabilitySnapshotQuery, 'providerId' | 'modelId'>

export function useModelCapabilities(options?: UseModelCapabilitiesOptions) {
  const modelClient = createModelClient()
  const snapshot = shallowRef<RendererModelCapabilities | null>(null)
  const status = ref<CapabilityLoadStatus>('idle')
  const error = shallowRef<unknown>(null)
  const lastQuery = shallowRef<CapabilitySnapshotQuery | null>(null)
  let requestId = 0

  const beginLoading = () => {
    requestId += 1
    snapshot.value = null
    error.value = null
    lastQuery.value = null
    status.value = 'loading'
  }

  const clear = () => {
    requestId += 1
    snapshot.value = null
    error.value = null
    lastQuery.value = null
    status.value = 'idle'
  }

  const load = async (
    query: CapabilitySnapshotQuery | null | undefined
  ): Promise<RendererModelCapabilities | null> => {
    const currentRequestId = ++requestId
    const normalizedProviderId = query?.providerId.trim()
    const normalizedModelId = query?.modelId.trim()

    snapshot.value = null
    error.value = null

    if (!query || !normalizedProviderId || !normalizedModelId) {
      lastQuery.value = null
      status.value = 'idle'
      return null
    }

    const normalizedQuery: CapabilitySnapshotQuery = {
      ...query,
      providerId: normalizedProviderId,
      modelId: normalizedModelId
    }
    lastQuery.value = normalizedQuery
    status.value = 'loading'

    try {
      const capabilities = await modelClient.getCapabilities(normalizedQuery)
      if (currentRequestId !== requestId) return null

      snapshot.value = capabilities
      status.value = 'ready'
      return capabilities
    } catch (caught) {
      if (currentRequestId !== requestId) return null

      error.value = caught
      status.value = 'error'
      console.warn('[ModelCapabilities] Failed to load model capabilities:', caught)
      return null
    }
  }

  const refresh = async (): Promise<RendererModelCapabilities | null> => {
    if (options) {
      const providerId = options.providerId.value
      const modelId = options.modelId.value
      return await load(providerId && modelId ? { providerId, modelId } : null)
    }

    const query = lastQuery.value
    return query ? await load(query) : null
  }

  if (options) {
    watch(
      () => [options.providerId.value, options.modelId.value] as const,
      () => {
        void refresh()
      },
      { immediate: true }
    )
  }

  const identity = computed(() => snapshot.value?.identity ?? null)
  const queryIdentity = computed<CapabilityQueryIdentity | null>(() => {
    const query = lastQuery.value
    return query
      ? {
          providerId: query.providerId,
          modelId: query.modelId
        }
      : null
  })
  const requestPolicy = computed(() => snapshot.value?.requestPolicy ?? null)
  const reasoningPortrait = computed(() => snapshot.value?.reasoningPortrait ?? null)
  const supportsReasoning = computed(() => {
    const value = snapshot.value?.supportsReasoning
    return typeof value === 'boolean' ? value : null
  })
  const budgetRange = computed(() =>
    mergeBudgetRanges(snapshot.value?.thinkingBudgetRange, reasoningPortrait.value?.budget)
  )
  const supportsSearch = computed(() => {
    const value = snapshot.value?.supportsSearch
    return typeof value === 'boolean' ? value : null
  })
  const searchDefaults = computed(() => snapshot.value?.searchDefaults ?? null)
  const temperatureControl = computed(() =>
    resolveGenerationParameterControl(requestPolicy.value?.temperature, status.value)
  )
  const topPControl = computed(() =>
    resolveGenerationParameterControl(requestPolicy.value?.topP, status.value)
  )
  const isLoading = computed(() => status.value === 'loading')

  return {
    snapshot,
    status,
    error,
    identity,
    queryIdentity,
    requestPolicy,
    reasoningPortrait,
    supportsReasoning,
    budgetRange,
    supportsSearch,
    searchDefaults,
    temperatureControl,
    topPControl,
    isLoading,
    beginLoading,
    load,
    refresh,
    clear
  }
}
