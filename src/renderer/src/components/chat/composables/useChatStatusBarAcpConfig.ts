import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { ProviderClient } from '@api/ProviderClient'
import type { SessionClient } from '@api/SessionClient'
import type { AcpConfigOption, AcpConfigState } from '@shared/presenter'

const ACP_INLINE_OPTION_LIMIT = 3

type Readable<T> = Ref<T> | ComputedRef<T>

type UseChatStatusBarAcpConfigOptions = {
  t: (key: string) => string
  isAcpAgent: Readable<boolean>
  activeAcpAgentId: Readable<string | null>
  activeAcpSessionId: Readable<string | null>
  acpWorkspacePath: Readable<string | null>
  selectedAgentId: Readable<string | null | undefined>
  selectedAgentName: Readable<string | null | undefined>
  providerClient: ProviderClient
  sessionClient: SessionClient
  resolveModelName: (providerId?: string | null, modelId?: string | null) => string
  resolveModelIconId: (providerId?: string | null, modelId?: string | null) => string
}

const isAcpConfigOptionValue = (
  value: unknown
): value is NonNullable<AcpConfigOption['options']>[number] => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.value === 'string' && typeof candidate.label === 'string'
}

const isAcpConfigOption = (value: unknown): value is AcpConfigOption => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.label !== 'string' ||
    (candidate.type !== 'select' && candidate.type !== 'boolean')
  ) {
    return false
  }

  if (!('currentValue' in candidate)) {
    return false
  }

  if (candidate.type === 'select' && candidate.options !== undefined) {
    return Array.isArray(candidate.options) && candidate.options.every(isAcpConfigOptionValue)
  }

  return true
}

const isAcpConfigState = (value: unknown): value is AcpConfigState => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    (candidate.source === 'configOptions' || candidate.source === 'legacy') &&
    Array.isArray(candidate.options) &&
    candidate.options.every(isAcpConfigOption)
  )
}

const hasAcpConfigState = (state: AcpConfigState | null | undefined): state is AcpConfigState =>
  Array.isArray(state?.options)

const getAcpOptionCurrentLabel = (option?: AcpConfigOption | null): string | null => {
  if (!option || option.type !== 'select') {
    return null
  }

  const currentValue = typeof option.currentValue === 'string' ? option.currentValue : ''
  return option.options?.find((entry) => entry.value === currentValue)?.label ?? currentValue
}

export function useChatStatusBarAcpConfig(options: UseChatStatusBarAcpConfigOptions) {
  const acpConfigState = ref<AcpConfigState | null>(null)
  const acpConfigLoadedRequestKey = ref<string | null>(null)
  const acpConfigLoadingRequestKey = ref<string | null>(null)
  const acpInlineOpenOptionId = ref<string | null>(null)
  const acpOptionSavingIds = ref<string[]>([])
  const acpConfigCacheByKey = new Map<string, AcpConfigState>()
  let acpConfigSyncToken = 0

  const getAcpProcessCacheKey = (
    agentId?: string | null,
    workdir?: string | null
  ): string | null => {
    if (!agentId) {
      return null
    }

    const normalizedWorkdir = workdir?.trim()
    return normalizedWorkdir ? `process:${agentId}::${normalizedWorkdir}` : `agent:${agentId}`
  }

  const acpConfigCacheKey = computed(() => {
    if (!options.isAcpAgent.value || options.activeAcpSessionId.value) {
      return null
    }

    return getAcpProcessCacheKey(options.activeAcpAgentId.value, options.acpWorkspacePath.value)
  })

  const acpConfigRequestKey = computed(() => {
    if (!options.isAcpAgent.value) {
      return null
    }

    if (options.activeAcpSessionId.value) {
      return `session:${options.activeAcpSessionId.value}`
    }

    return acpConfigCacheKey.value
  })

  const getCachedAcpConfigState = (cacheKey?: string | null): AcpConfigState | null => {
    if (!cacheKey) {
      return null
    }

    return acpConfigCacheByKey.get(cacheKey) ?? null
  }

  const setCachedAcpConfigState = (
    cacheKey: string | null | undefined,
    state: AcpConfigState | null | undefined
  ): void => {
    if (!cacheKey || !hasAcpConfigState(state)) {
      return
    }

    acpConfigCacheByKey.set(cacheKey, state)
  }

  const acpConfigOptions = computed(() => acpConfigState.value?.options ?? [])
  const isAcpConfigLoading = computed(() => {
    if (!options.isAcpAgent.value || options.activeAcpSessionId.value) {
      return false
    }

    const requestKey = acpConfigRequestKey.value
    return Boolean(requestKey && acpConfigLoadingRequestKey.value === requestKey)
  })

  const isAcpSessionConfigLoaded = computed(() => {
    if (!options.activeAcpSessionId.value) {
      return false
    }

    return acpConfigLoadedRequestKey.value === acpConfigRequestKey.value
  })

  const acpConfigReadOnly = computed(() => {
    if (!options.isAcpAgent.value) {
      return false
    }

    if (!options.activeAcpSessionId.value) {
      return true
    }

    return !isAcpSessionConfigLoaded.value
  })

  const acpInlineOptions = computed(() =>
    acpConfigOptions.value
      .filter((option) => option.type === 'select')
      .slice(0, ACP_INLINE_OPTION_LIMIT)
  )

  const acpOverflowOptions = computed(() => {
    const inlineIds = new Set(acpInlineOptions.value.map((option) => option.id))
    return acpConfigOptions.value.filter((option) => !inlineIds.has(option.id))
  })

  const acpAgentLabel = computed(() => {
    const modelId = options.activeAcpAgentId.value ?? options.selectedAgentId.value
    return (
      options.resolveModelName('acp', modelId) ||
      options.selectedAgentName.value ||
      modelId ||
      options.t('chat.mode.acpAgent')
    )
  })

  const acpAgentIconId = computed(() =>
    options.resolveModelIconId(
      'acp',
      options.activeAcpAgentId.value ?? options.selectedAgentId.value
    )
  )

  const getAcpOptionDisplayValue = (option: AcpConfigOption): string => {
    if (option.type === 'boolean') {
      return options.t(option.currentValue ? 'common.enabled' : 'common.disabled')
    }

    const currentLabel = getAcpOptionCurrentLabel(option)
    if (currentLabel?.trim()) {
      return currentLabel
    }

    if (typeof option.currentValue === 'string' && option.currentValue.trim()) {
      return option.currentValue
    }

    return ''
  }

  const setAcpConfigLoadingRequest = (requestKey: string | null | undefined): void => {
    acpConfigLoadingRequestKey.value = requestKey?.trim() ? requestKey : null
  }

  const clearAcpConfigLoadingRequest = (requestKey?: string | null): void => {
    if (!requestKey || acpConfigLoadingRequestKey.value === requestKey) {
      acpConfigLoadingRequestKey.value = null
    }
  }

  const matchesCurrentAcpWarmupTarget = (
    agentId: string | null | undefined,
    workdir: string | null | undefined
  ): boolean => {
    if (
      options.activeAcpSessionId.value ||
      !agentId ||
      options.activeAcpAgentId.value !== agentId
    ) {
      return false
    }

    const expectedWorkdir = options.acpWorkspacePath.value?.trim()
    if (!expectedWorkdir) {
      return true
    }

    return workdir?.trim() === expectedWorkdir
  }

  const syncAcpConfigOptions = async () => {
    const token = ++acpConfigSyncToken
    const requestKey = acpConfigRequestKey.value
    acpInlineOpenOptionId.value = null

    if (!options.isAcpAgent.value || !requestKey) {
      acpConfigState.value = null
      acpConfigLoadedRequestKey.value = null
      clearAcpConfigLoadingRequest()
      return
    }

    const agentId = options.activeAcpAgentId.value

    if (options.activeAcpSessionId.value) {
      clearAcpConfigLoadingRequest()
      acpConfigState.value = null
      acpConfigLoadedRequestKey.value = null

      try {
        const state = await options.sessionClient.getAcpSessionConfigOptions(
          options.activeAcpSessionId.value
        )
        if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
          return
        }

        acpConfigState.value = state
        acpConfigLoadedRequestKey.value = requestKey
        clearAcpConfigLoadingRequest(requestKey)
        return
      } catch (error) {
        console.warn('[ChatStatusBar] Failed to load ACP session config options:', error)
        if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
          return
        }

        acpConfigState.value = null
        acpConfigLoadedRequestKey.value = null
        clearAcpConfigLoadingRequest(requestKey)
        return
      }
    }

    acpConfigLoadedRequestKey.value = null
    const cacheKey = acpConfigCacheKey.value
    const cachedState = getCachedAcpConfigState(cacheKey)
    acpConfigState.value = cachedState

    if (hasAcpConfigState(cachedState)) {
      clearAcpConfigLoadingRequest(requestKey)
    } else {
      setAcpConfigLoadingRequest(requestKey)
    }

    if (!agentId) {
      return
    }

    try {
      try {
        await options.providerClient.warmupAcpProcess(
          agentId,
          options.acpWorkspacePath.value ?? undefined
        )
      } catch (error) {
        console.warn('[ChatStatusBar] Failed to warmup ACP process:', error)
      }

      const state = await options.providerClient.getAcpProcessConfigOptions(
        agentId,
        options.acpWorkspacePath.value ?? undefined
      )
      if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
        return
      }

      if (!hasAcpConfigState(state)) {
        acpConfigState.value = getCachedAcpConfigState(cacheKey)
        clearAcpConfigLoadingRequest(requestKey)
        return
      }

      setCachedAcpConfigState(cacheKey, state)
      acpConfigState.value = state
      clearAcpConfigLoadingRequest(requestKey)
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to load ACP process config options:', error)
      if (token !== acpConfigSyncToken || acpConfigRequestKey.value !== requestKey) {
        return
      }

      acpConfigState.value = getCachedAcpConfigState(cacheKey)
      clearAcpConfigLoadingRequest(requestKey)
    }
  }

  const updateAcpConfigOption = async (configId: string, value: string | boolean) => {
    const sessionId = options.activeAcpSessionId.value
    if (!sessionId || !isAcpSessionConfigLoaded.value) {
      return
    }

    if (acpOptionSavingIds.value.includes(configId)) {
      return
    }

    acpOptionSavingIds.value = [...acpOptionSavingIds.value, configId]
    try {
      const updated = await options.sessionClient.setAcpSessionConfigOption(
        sessionId,
        configId,
        value
      )
      if (options.activeAcpSessionId.value !== sessionId) {
        return
      }

      acpConfigState.value = updated
    } catch (error) {
      console.warn('[ChatStatusBar] Failed to update ACP config option:', error)
    } finally {
      acpOptionSavingIds.value = acpOptionSavingIds.value.filter((id) => id !== configId)
    }
  }

  const isAcpOptionSaving = (configId: string) => acpOptionSavingIds.value.includes(configId)

  const handleAcpConfigOptionsReady = (payload?: Record<string, unknown>) => {
    if (!payload || !options.isAcpAgent.value) {
      return
    }

    const conversationId = typeof payload.conversationId === 'string' ? payload.conversationId : ''
    const agentId = typeof payload.agentId === 'string' ? payload.agentId : ''
    const workdir = typeof payload.workdir === 'string' ? payload.workdir : ''

    if (!isAcpConfigState(payload.configState)) {
      return
    }

    if (conversationId) {
      if (options.activeAcpSessionId.value !== conversationId) {
        return
      }

      acpConfigState.value = payload.configState
      acpConfigLoadedRequestKey.value = `session:${conversationId}`
      clearAcpConfigLoadingRequest(`session:${conversationId}`)
      return
    }

    if (!matchesCurrentAcpWarmupTarget(agentId, workdir)) {
      return
    }

    setCachedAcpConfigState(getAcpProcessCacheKey(agentId, workdir), payload.configState)

    if (!options.activeAcpSessionId.value) {
      acpConfigState.value = payload.configState
      clearAcpConfigLoadingRequest(acpConfigRequestKey.value)
    }
  }

  const onAcpInlineOptionOpenChange = (optionId: string, open: boolean) => {
    if (open) {
      acpInlineOpenOptionId.value = optionId
      return
    }

    if (acpInlineOpenOptionId.value === optionId) {
      acpInlineOpenOptionId.value = null
    }
  }

  const onAcpSelectOption = (configId: string, value: string) => {
    if (!value) {
      return
    }

    acpInlineOpenOptionId.value = null
    void updateAcpConfigOption(configId, value)
  }

  const onAcpBooleanOption = (configId: string, value: boolean) => {
    void updateAcpConfigOption(configId, value)
  }

  watch(
    () => acpInlineOptions.value.map((option) => option.id),
    (optionIds) => {
      if (acpInlineOpenOptionId.value && !optionIds.includes(acpInlineOpenOptionId.value)) {
        acpInlineOpenOptionId.value = null
      }
    }
  )

  return {
    acpConfigState,
    acpInlineOpenOptionId,
    acpConfigReadOnly,
    acpInlineOptions,
    acpOverflowOptions,
    acpAgentLabel,
    acpAgentIconId,
    isAcpConfigLoading,
    getAcpOptionDisplayValue,
    isAcpOptionSaving,
    syncAcpConfigOptions,
    handleAcpConfigOptionsReady,
    onAcpInlineOptionOpenChange,
    onAcpSelectOption,
    onAcpBooleanOption
  }
}
