import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import type { Ref } from 'vue'

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
  const threadPresenter = usePresenter('threadPresenter')

  const currentMode = ref<string>('default')
  const availableModes = ref<ModeInfo[]>([])
  const loading = ref(false)
  const lastWarmupModesKey = ref<string | null>(null)

  const isAcpModel = computed(
    () => options.activeModel.value?.providerId === 'acp' && !!options.activeModel.value?.id
  )

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
      const result = await threadPresenter.getAcpSessionModes(options.conversationId.value)
      if (result && result.available.length > 0) {
        currentMode.value = result.current
        availableModes.value = result.available
        console.info(
          `[useAcpMode] Loaded modes: current="${result.current}", available=[${result.available.map((m) => m.id).join(', ')}]`
        )
      }
    } catch (error) {
      console.warn('[useAcpMode] Failed to load modes', error)
    } finally {
      loading.value = false
    }
  }

  const loadWarmupModes = async () => {
    if (!isAcpModel.value || hasConversation.value) return
    const agentId = options.activeModel.value?.id
    const workdir = selectedWorkdir.value
    if (!agentId || !workdir) return
    if (availableModes.value.length > 0) return

    const warmupKey = `${agentId}::${workdir}`
    if (lastWarmupModesKey.value === warmupKey) return
    lastWarmupModesKey.value = warmupKey

    try {
      const result = await threadPresenter.getAcpProcessModes(agentId, workdir)
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
    [isAcpModel, options.conversationId],
    () => {
      void loadModes()
    },
    { immediate: true }
  )

  // Load warmup modes when a workdir is selected but no conversation exists yet
  watch(
    [isAcpModel, selectedWorkdir, options.conversationId],
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

  // Listen for session modes ready event from main process
  const handleModesReady = (
    _: unknown,
    payload: {
      conversationId?: string
      agentId?: string
      workdir?: string
      current: string
      available: ModeInfo[]
    }
  ) => {
    if (!isAcpModel.value) return

    const conversationMatch =
      payload.conversationId && payload.conversationId === options.conversationId.value
    const agentMatch = payload.agentId && payload.agentId === options.activeModel.value?.id
    const workdirMatch =
      !selectedWorkdir.value || !payload.workdir || selectedWorkdir.value === payload.workdir

    if (conversationMatch || (agentMatch && workdirMatch)) {
      console.info(
        `[useAcpMode] Received modes from main: current="${payload.current}", available=[${payload.available.map((m) => m.id).join(', ')}]`
      )
      currentMode.value = payload.current
      availableModes.value = payload.available
    }
  }

  onMounted(() => {
    window.electron.ipcRenderer.on(ACP_WORKSPACE_EVENTS.SESSION_MODES_READY, handleModesReady)
  })

  onUnmounted(() => {
    window.electron.ipcRenderer.removeListener(
      ACP_WORKSPACE_EVENTS.SESSION_MODES_READY,
      handleModesReady
    )
  })

  /**
   * Cycle to the next mode in the agent's available modes.
   * Only works when agent has declared modes.
   */
  const cycleMode = async () => {
    if (
      loading.value ||
      !isAcpModel.value ||
      !options.conversationId.value ||
      !hasAgentModes.value
    ) {
      return
    }

    const cycleOrder = modeCycleOrder.value
    const currentIndex = cycleOrder.indexOf(currentMode.value)
    // If current mode not in cycle, start from beginning
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cycleOrder.length : 0
    const nextModeId = cycleOrder[nextIndex]

    loading.value = true
    try {
      console.info(
        `[useAcpMode] Cycling mode: "${currentMode.value}" -> "${nextModeId}" (cycle: [${cycleOrder.join(', ')}])`
      )
      await threadPresenter.setAcpSessionMode(options.conversationId.value, nextModeId)
      currentMode.value = nextModeId
    } catch (error) {
      console.error('[useAcpMode] Failed to cycle mode', error)
    } finally {
      loading.value = false
    }
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
    loading
  }
}
