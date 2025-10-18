import { ref } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from 'vue-i18n'

export function useCleanDialog() {
  const { t } = useI18n()
  const chatStore = useChatStore()
  const isOpen = ref(false)

  const open = () => {
    isOpen.value = true
  }

  const cancel = () => {
    isOpen.value = false
  }

  const confirm = async () => {
    try {
      const threadId = chatStore.getActiveThreadId()
      if (!threadId) {
        return
      }
      await chatStore.clearAllMessages(threadId)
    } catch (error) {
      console.error(t('common.error.cleanMessagesFailed'), error)
    }

    isOpen.value = false
  }

  return {
    isOpen,
    open,
    cancel,
    confirm
  }
}
