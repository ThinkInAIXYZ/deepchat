// === Vue Core ===
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

export type ChatMode = 'chat' | 'agent' | 'acp agent'

const MODE_ICONS = {
  chat: 'lucide:message-circle-more',
  agent: 'lucide:bot',
  'acp agent': 'lucide:bot-message-square'
} as const

// Shared state so all callers observe the same mode.
const currentMode = ref<ChatMode>('chat')
let hasLoaded = false
let loadPromise: Promise<void> | null = null
let modeUpdateVersion = 0

/**
 * Manages chat mode selection (chat, agent, acp agent)
 * Similar to useInputSettings, stores mode in database via configPresenter
 */
export function useChatMode() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')
  const { t } = useI18n()

  // === Computed ===
  const currentIcon = computed(() => MODE_ICONS[currentMode.value])
  const currentLabel = computed(() => {
    if (currentMode.value === 'chat') return t('chat.mode.chat')
    if (currentMode.value === 'agent') return t('chat.mode.agent')
    return t('chat.mode.acpAgent')
  })
  const isAgentMode = computed(
    () => currentMode.value === 'agent' || currentMode.value === 'acp agent'
  )

  const modes = computed(() => [
    { value: 'chat' as ChatMode, label: t('chat.mode.chat'), icon: MODE_ICONS.chat },
    { value: 'agent' as ChatMode, label: t('chat.mode.agent'), icon: MODE_ICONS.agent },
    {
      value: 'acp agent' as ChatMode,
      label: t('chat.mode.acpAgent'),
      icon: MODE_ICONS['acp agent']
    }
  ])

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
      // TODO: Show user-facing notification when toast system is available
    }
  }

  const loadMode = async () => {
    const loadVersion = modeUpdateVersion
    try {
      const saved = await configPresenter.getSetting<string>('input_chatMode')
      if (modeUpdateVersion === loadVersion) {
        currentMode.value = (saved as ChatMode) || 'chat'
      }
    } catch (error) {
      // Fall back to safe defaults on error
      if (modeUpdateVersion === loadVersion) {
        currentMode.value = 'chat'
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

  return {
    currentMode,
    currentIcon,
    currentLabel,
    isAgentMode,
    modes,
    setMode,
    loadMode
  }
}
