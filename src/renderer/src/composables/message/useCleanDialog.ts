import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from 'vue-i18n'

const isOpen = ref(false)
const targetThreadId = ref<string | null>(null)

export function useCleanDialog() {
  const { t } = useI18n()
  const chatStore = useChatStore()

  const open = (threadId?: string) => {
    const nextTarget = threadId ?? chatStore.getActiveThreadId()
    if (!nextTarget) {
      return
    }
    targetThreadId.value = nextTarget
    isOpen.value = true
  }

  const cancel = () => {
    isOpen.value = false
    targetThreadId.value = null
  }

  const confirm = async () => {
    try {
      const threadId = targetThreadId.value ?? chatStore.getActiveThreadId()
      if (!threadId) {
        return
      }
      await chatStore.clearAllMessages(threadId)
    } catch (error) {
      console.error(t('common.error.cleanMessagesFailed'), error)
    }

    isOpen.value = false
    targetThreadId.value = null
  }

  return {
    isOpen,
    open,
    cancel,
    confirm
  }
}
