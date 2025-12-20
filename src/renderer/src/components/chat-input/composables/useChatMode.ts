// === Vue Core ===
import { ref, onMounted, computed } from 'vue'

// === Composables ===
import { usePresenter } from '@/composables/usePresenter'

export type ChatMode = 'chat' | 'agent' | 'acp agent'

const MODE_ICONS = {
  chat: 'lucide:message-circle-more',
  agent: 'lucide:bot',
  'acp agent': 'lucide:bot-message-square'
} as const

const MODE_LABELS = {
  chat: 'Chat',
  agent: 'Agent',
  'acp agent': 'ACP Agent'
} as const

/**
 * Manages chat mode selection (chat, agent, acp agent)
 * Similar to useInputSettings, stores mode in database via configPresenter
 */
export function useChatMode() {
  // === Presenters ===
  const configPresenter = usePresenter('configPresenter')

  // === Local State ===
  const currentMode = ref<ChatMode>('chat')

  // === Computed ===
  const currentIcon = computed(() => MODE_ICONS[currentMode.value])
  const currentLabel = computed(() => MODE_LABELS[currentMode.value])
  const isAgentMode = computed(
    () => currentMode.value === 'agent' || currentMode.value === 'acp agent'
  )

  const modes = computed(() => [
    { value: 'chat' as ChatMode, label: MODE_LABELS.chat, icon: MODE_ICONS.chat },
    { value: 'agent' as ChatMode, label: MODE_LABELS.agent, icon: MODE_ICONS.agent },
    {
      value: 'acp agent' as ChatMode,
      label: MODE_LABELS['acp agent'],
      icon: MODE_ICONS['acp agent']
    }
  ])

  // === Public Methods ===
  const setMode = async (mode: ChatMode) => {
    const previousValue = currentMode.value
    currentMode.value = mode

    try {
      await configPresenter.setSetting('input_chatMode', mode)
    } catch (error) {
      // Revert to previous value on error
      currentMode.value = previousValue
      console.error('Failed to save chat mode:', error)
      // TODO: Show user-facing notification when toast system is available
    }
  }

  const loadMode = async () => {
    try {
      const saved = await configPresenter.getSetting<string>('input_chatMode')
      currentMode.value = (saved as ChatMode) || 'chat'
    } catch (error) {
      // Fall back to safe defaults on error
      currentMode.value = 'chat'
      console.error('Failed to load chat mode, using default:', error)
    }
  }

  // === Lifecycle Hooks ===
  onMounted(async () => {
    try {
      await loadMode()
    } catch (error) {
      console.error('Failed to initialize chat mode:', error)
    }
  })

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
