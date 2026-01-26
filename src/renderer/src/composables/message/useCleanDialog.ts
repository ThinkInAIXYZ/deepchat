import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from 'vue-i18n'

const isOpen = ref(false)
const targetSessionId = ref<string | null>(null)

export function useCleanDialog() {
  const { t } = useI18n()
  const chatStore = useChatStore()

  const open = (sessionId?: string) => {
    const nextTarget = sessionId ?? chatStore.getActiveSessionId()
    if (!nextTarget) {
      return
    }
    targetSessionId.value = nextTarget
    isOpen.value = true
  }

  const cancel = () => {
    isOpen.value = false
    targetSessionId.value = null
  }

  const confirm = async () => {
    try {
      const sessionId = targetSessionId.value ?? chatStore.getActiveSessionId()
      if (!sessionId) {
        return
      }
      await chatStore.clearAllMessages(sessionId)
    } catch (error) {
      console.error(t('common.error.cleanMessagesFailed'), error)
    }

    isOpen.value = false
    targetSessionId.value = null
  }

  return {
    isOpen,
    open,
    cancel,
    confirm
  }
}
