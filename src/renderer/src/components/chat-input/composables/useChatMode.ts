// === Vue Core ===
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

export type ChatMode = 'agent'

const MODE_ICONS = {
  chat: 'lucide:message-circle-more',
  agent: 'lucide:bot'
} as const

// Shared state so all callers observe the same mode.
const currentMode = ref<ChatMode>('agent')
let hasLoaded = false
let loadPromise: Promise<void> | null = null
let modeUpdateVersion = 0

/**
 * Manages chat mode selection (agent only after ACP cleanup)
 * Similar to useInputSettings, stores mode in database via configPresenter
 */
export function useChatMode() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')
  const { t } = useI18n()

  // === Computed ===
  const currentIcon = computed(() => MODE_ICONS[currentMode.value])
  const currentLabel = computed(() => {
    return t('chat.mode.agent')
  })
  const isAgentMode = computed(() => currentMode.value === 'agent')

  const modes = computed(() => {
    return [{ value: 'agent' as ChatMode, label: t('chat.mode.agent'), icon: MODE_ICONS.agent }]
  })

  // === Public Methods ===
  const setMode = async (mode: ChatMode) => {
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
    }
  }

  const loadMode = async () => {
    const loadVersion = modeUpdateVersion
    try {
      const saved = await configPresenter.getSetting<string>('input_chatMode')
      if (modeUpdateVersion === loadVersion) {
        // Normalize any legacy mode to 'agent'
        currentMode.value = 'agent'
        // If saved mode was something else, update it
        if (saved && saved !== 'agent') {
          await configPresenter.setSetting('input_chatMode', 'agent')
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

  // Kept for API compatibility but now a no-op
  const refreshAcpAgents = async () => {
    // No-op after ACP cleanup
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
