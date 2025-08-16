import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ArtifactState {
  id: string
  type: string
  title: string
  content: string
  status: 'loading' | 'loaded' | 'error'
  language?: string
}

export const useArtifactStore = defineStore('artifact', () => {
  const currentArtifact = ref<ArtifactState | null>(null)
  const isOpen = ref(false)
  const currentMessageId = ref<string | null>(null)
  const currentThreadId = ref<string | null>(null)

  const showArtifact = (artifact: ArtifactState, messageId: string, threadId: string) => {
    currentArtifact.value = artifact
    currentMessageId.value = messageId
    currentThreadId.value = threadId
    isOpen.value = true
  }

  const hideArtifact = () => {
    currentArtifact.value = null
    currentMessageId.value = null
    currentThreadId.value = null
    isOpen.value = false
  }

  const validateContext = (messageId: string, threadId: string) => {
    return currentMessageId.value === messageId && currentThreadId.value === threadId
  }

  const updateArtifactContent = (updates: Partial<ArtifactState>) => {
    if (currentArtifact.value) {
      // Create a new object to trigger reactivity
      currentArtifact.value = {
        ...currentArtifact.value,
        ...updates
      }
    }
  }

  return {
    currentArtifact,
    currentMessageId,
    currentThreadId,
    isOpen,
    showArtifact,
    hideArtifact,
    validateContext,
    updateArtifactContent
  }
})
