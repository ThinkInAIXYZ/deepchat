// === Vue Core ===
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'
import { CONFIG_EVENTS } from '@/events'

export type ChatMode = 'agent' | 'acp agent'

const MODE_ICONS = {
  agent: 'lucide:bot',
  'acp agent': 'lucide:bot-message-square'
} as const

// Shared state so all callers observe the same mode.
const currentMode = ref<ChatMode>('agent')
const hasAcpAgents = ref<boolean>(false)
let hasLoaded = false
let loadPromise: Promise<void> | null = null
let modeUpdateVersion = 0
let hasAcpListener = false

/**
 * Manages chat mode selection (agent, acp agent)
 * Similar to useInputSettings, stores mode in database via configPresenter
 */
export function useChatMode() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')
  const { t } = useI18n()

  // === Computed ===
  const currentIcon = computed(() => MODE_ICONS[currentMode.value])
  const currentLabel = computed(() => {
    if (currentMode.value === 'agent') return t('chat.mode.agent')
    return t('chat.mode.acpAgent')
  })
  const isAgentMode = computed(() => true)

  const modes = computed(() => {
    const allModes = [
      { value: 'agent' as ChatMode, label: t('chat.mode.agent'), icon: MODE_ICONS.agent },
      {
        value: 'acp agent' as ChatMode,
        label: t('chat.mode.acpAgent'),
        icon: MODE_ICONS['acp agent']
      }
    ]
    // Filter out 'acp agent' mode if no ACP agents are configured
    if (!hasAcpAgents.value) {
      return allModes.filter((mode) => mode.value !== 'acp agent')
    }
    return allModes
  })

  // === Public Methods ===
  const setMode = async (mode: ChatMode) => {
    // Prevent setting 'acp agent' mode if no agents are configured
    if (mode === 'acp agent' && !hasAcpAgents.value) {
      console.warn('Cannot set acp agent mode: no ACP agents configured')
      return
    }

    const previousValue = currentMode.value
    const updateVersion = ++modeUpdateVersion
    currentMode.value = mode

    try {
      await configPresenter.setSetting('input_chatMode', mode)
    } catch (error) {
      // Revert to previous value on error
      if (modeUpdateVersion === updateVersion) {
        currentMode.value = previousValue
      }
      console.error('Failed to save chat mode:', error)
      // TODO: Show user-facing notification when toast system is available
    }
  }

  const checkAcpAgents = async () => {
    try {
      const acpEnabled = await configPresenter.getAcpEnabled()
      if (!acpEnabled) {
        hasAcpAgents.value = false
        return
      }
      const agents = await configPresenter.getAcpAgents()
      hasAcpAgents.value = agents.length > 0
    } catch (error) {
      console.warn('Failed to check ACP agents:', error)
      hasAcpAgents.value = false
    }
  }

  const loadMode = async () => {
    const loadVersion = modeUpdateVersion
    try {
      // Check ACP agents availability first
      await checkAcpAgents()

      const saved = await configPresenter.getSetting<string>('input_chatMode')
      if (modeUpdateVersion === loadVersion) {
        let savedMode: ChatMode = saved === 'acp agent' ? 'acp agent' : 'agent'

        // Migrate legacy 'chat' mode to 'agent' and persist
        if (saved === 'chat') {
          savedMode = 'agent'
          await configPresenter.setSetting('input_chatMode', 'agent')
        }

        // If saved mode is 'acp agent' but no agents are configured, fall back to 'agent'
        if (savedMode === 'acp agent' && !hasAcpAgents.value) {
          currentMode.value = 'agent'
          await configPresenter.setSetting('input_chatMode', 'agent')
        } else {
          currentMode.value = savedMode
        }
      }
    } catch (error) {
      // Fall back to safe defaults on error
      if (modeUpdateVersion === loadVersion) {
        currentMode.value = 'agent'
      }
      console.error('Failed to load chat mode, using default:', error)
    } finally {
      hasLoaded = true
    }
  }

  const ensureLoaded = () => {
    if (hasLoaded) return
    if (!loadPromise) {
      loadPromise = loadMode().finally(() => {
        loadPromise = null
      })
    }
  }

  ensureLoaded()

  if (!hasAcpListener && window.electron?.ipcRenderer) {
    hasAcpListener = true
    window.electron.ipcRenderer.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, (_, providerId?: string) => {
      if (!providerId || providerId === 'acp') {
        void checkAcpAgents()
      }
    })
  }

  // Watch for ACP agents changes and update availability
  // This will be triggered when ACP agents are added/removed
  watch(
    () => hasAcpAgents.value,
    (hasAgents) => {
      // If current mode is 'acp agent' but agents are removed, switch to 'agent'
      if (!hasAgents && currentMode.value === 'acp agent') {
        setMode('agent')
      }
    }
  )

  // Periodically check for ACP agents changes (in case they're updated elsewhere)
  // This is a simple approach; in production, you might want to use events
  const refreshAcpAgents = async () => {
    await checkAcpAgents()
  }

  return {
    currentMode,
    currentIcon,
    currentLabel,
    isAgentMode,
    modes,
    setMode,
    loadMode,
    refreshAcpAgents
  }
}
