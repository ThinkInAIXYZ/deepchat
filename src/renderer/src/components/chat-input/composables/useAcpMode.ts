import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useAcpRuntimeAdapter } from '@/composables/chat/useAcpRuntimeAdapter'
import { useAcpEventsAdapter } from '@/composables/acp/useAcpEventsAdapter'
import type { Ref } from 'vue'
import type { SessionUpdatedEvent } from '@shared/types/presenters/agentic.presenter.d'

type ActiveModelRef = Ref<{ id?: string; providerId?: string } | null>

interface UseAcpModeOptions {
  activeModel: ActiveModelRef
  conversationId: Ref<string | null>
  /** Streaming state - used to detect when session has been created */
  isStreaming?: Ref<boolean>
  workdir?: Ref<string | null>
}

interface ModeInfo {
  id: string
  name: string
  description: string
}

export function useAcpMode(options: UseAcpModeOptions) {
  const acpRuntimeAdapter = useAcpRuntimeAdapter()
  const acpEventsAdapter = useAcpEventsAdapter()
  let unsubscribeSessionModes: (() => void) | null = null

  const currentMode = ref<string>('default')
  const availableModes = ref<ModeInfo[]>([])
  const loading = ref(false)
  const lastWarmupModesKey = ref<string | null>(null)
  const pendingPreferredMode = ref<string | null>(null)

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )
  const agentId = computed(() => options.activeModel.value?.id ?? '')

  const hasConversation = computed(() => Boolean(options.conversationId.value))
  const selectedWorkdir = computed(() => options.workdir?.value ?? null)

  /**
   * Whether the agent has declared any available modes.
   * Mode button is only shown when this is true.
   */
  const hasAgentModes = computed(() => availableModes.value.length > 0)

  /**
   * Get the list of mode IDs to cycle through (from agent's available modes).
   */
  const modeCycleOrder = computed(() => availableModes.value.map((m) => m.id))

  const loadModes = async () => {
    if (!isAcpModel.value || !hasConversation.value || !options.conversationId.value) {
      currentMode.value = 'default'
      availableModes.value = []
      return
    }

    loading.value = true
    try {
      const result = await acpRuntimeAdapter.getAcpSessionModes(options.conversationId.value)
      if (result && result.available.length > 0) {
        currentMode.value = result.current
        availableModes.value = result.available
        console.info(
          `[useAcpMode] Loaded modes: current="${result.current}", available=[${result.available.map((m) => m.id).join(', ')}]`
        )
      } else {
        currentMode.value = 'default'
        availableModes.value = []
      }
    } catch (error) {
      console.warn('[useAcpMode] Failed to load modes', error)
    } finally {
      loading.value = false
    }
  }

  const loadWarmupModes = async () => {
    if (!isAcpModel.value || hasConversation.value) return
    if (!agentId.value) return
    if (availableModes.value.length > 0) return

    // Use selected workdir or null (will use config warmup dir on backend)
    const workdir = selectedWorkdir.value

    const warmupKey = `${agentId.value}::${workdir ?? 'config-warmup'}`
    if (lastWarmupModesKey.value === warmupKey) return
    lastWarmupModesKey.value = warmupKey

    try {
      // First try to get modes from existing process (only if workdir is specified)
      let result = workdir
        ? await acpRuntimeAdapter.getAcpProcessModes(agentId.value, workdir)
        : undefined

      // If no modes found, ensure warmup process exists and try again
      if (!result?.availableModes) {
        // ensureAcpWarmup will use config warmup dir when workdir is null
        await acpRuntimeAdapter.ensureAcpWarmup(agentId.value, workdir)

        // Wait a short time for the warmup process to fetch modes
        await new Promise((resolve) => setTimeout(resolve, 500))

        // Query again after warmup
        // When workdir is null, backend uses config warmup dir internally
        // We pass empty string to query the config warmup process
        const queryWorkdir = workdir ?? ''
        result = await acpRuntimeAdapter.getAcpProcessModes(agentId.value, queryWorkdir)
      }

      if (result?.availableModes && result.availableModes.length > 0) {
        currentMode.value =
          result.currentModeId ?? result.availableModes[0]?.id ?? currentMode.value
        availableModes.value = result.availableModes
        console.info(
          `[useAcpMode] Loaded warmup modes: current="${currentMode.value}", available=[${result.availableModes.map((m) => m.id).join(', ')}]`
        )
      }
    } catch (error) {
      console.warn('[useAcpMode] Failed to load warmup modes', error)
    }
  }

  // Watch for conversation and model changes
  watch(
    [isAcpModel, options.conversationId, agentId],
    () => {
      void loadModes()
    },
    { immediate: true }
  )

  // Load warmup modes when a workdir is selected but no conversation exists yet
  watch(
    [isAcpModel, selectedWorkdir, options.conversationId, agentId],
    () => {
      if (!hasConversation.value) {
        void loadWarmupModes()
      }
    },
    { immediate: true }
  )

  // Watch for streaming state changes - reload modes when streaming ends
  // This is when the ACP session has been created after sending a message
  if (options.isStreaming) {
    watch(options.isStreaming, (newVal, oldVal) => {
      // When streaming goes from true to false, session should be created
      if (oldVal === true && newVal === false && !hasAgentModes.value) {
        console.info('[useAcpMode] Streaming ended, reloading modes...')
        void loadModes()
      }
    })
  }

  watch(agentId, (newId, oldId) => {
    if (!newId || newId === oldId) return
    currentMode.value = 'default'
    availableModes.value = []
    pendingPreferredMode.value = null
    lastWarmupModesKey.value = null
  })

  /**
   * Listen for session updated event from agentic presenter
   * Checks for availableModes in sessionInfo to detect mode updates
   */
  const handleSessionUpdated = (payload: SessionUpdatedEvent) => {
    if (!isAcpModel.value || !payload.sessionInfo.availableModes) return

    const conversationMatch = payload.sessionId === options.conversationId.value
    const agentMatch = payload.sessionInfo.agentId === options.activeModel.value?.id

    if (conversationMatch || agentMatch) {
      const modes: ModeInfo[] = payload.sessionInfo.availableModes.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description
      }))
      const newModeId = payload.sessionInfo.currentModeId || modes[0]?.id || 'default'

      console.info(
        `[useAcpMode] Received modes from main: current="${newModeId}", available=[${modes.map((m) => m.id).join(', ')}]`
      )
      currentMode.value = newModeId
      availableModes.value = modes
      if (!conversationMatch && pendingPreferredMode.value) {
        currentMode.value = pendingPreferredMode.value
      }
    }
  }

  onMounted(() => {
    unsubscribeSessionModes = acpEventsAdapter.subscribeSessionUpdated(handleSessionUpdated)
  })

  onUnmounted(() => {
    unsubscribeSessionModes?.()
    unsubscribeSessionModes = null
  })

  /**
   * Cycle to the next mode in the agent's available modes.
   * Only works when agent has declared modes.
   */
  const setMode = async (modeId: string) => {
    if (loading.value || !isAcpModel.value || !modeId || !agentId.value) {
      return
    }
    if (modeId === currentMode.value) {
      return
    }

    loading.value = true
    try {
      if (options.conversationId.value) {
        await acpRuntimeAdapter.setAcpSessionMode(options.conversationId.value, modeId)
        currentMode.value = modeId
        pendingPreferredMode.value = null
      } else if (selectedWorkdir.value) {
        await acpRuntimeAdapter.setAcpPreferredProcessMode(
          agentId.value,
          selectedWorkdir.value,
          modeId
        )
        currentMode.value = modeId
        pendingPreferredMode.value = modeId
      }
    } catch (error) {
      console.error('[useAcpMode] Failed to set mode', error)
    } finally {
      loading.value = false
    }
  }

  const cycleMode = async () => {
    if (loading.value || !isAcpModel.value || !hasAgentModes.value) {
      return
    }

    const cycleOrder = modeCycleOrder.value
    const currentIndex = cycleOrder.indexOf(currentMode.value)
    // If current mode not in cycle, start from beginning
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cycleOrder.length : 0
    const nextModeId = cycleOrder[nextIndex]

    console.info(
      `[useAcpMode] Cycling mode: "${currentMode.value}" -> "${nextModeId}" (cycle: [${cycleOrder.join(', ')}])`
    )
    await setMode(nextModeId)
  }

  const currentModeInfo = computed(() => {
    return availableModes.value.find((m) => m.id === currentMode.value)
  })

  /**
   * Get display name for current mode.
   * Uses agent's mode name directly, falls back to mode id if name is not available.
   */
  const currentModeName = computed(() => {
    const modeInfo = currentModeInfo.value
    // Use agent's mode name directly, or fall back to mode id
    return modeInfo?.name || currentMode.value
  })

  return {
    isAcpModel,
    currentMode,
    currentModeName,
    currentModeInfo,
    availableModes,
    hasAgentModes,
    cycleMode,
    setMode,
    loading
  }
}
