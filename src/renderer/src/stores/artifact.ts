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

const makeContextKey = (artifactId: string, messageId: string, sessionId: string) =>
  `${sessionId}:${messageId}:${artifactId}`

interface ShowArtifactOptions {
  force?: boolean
}

export const useArtifactStore = defineStore('artifact', () => {
  const currentArtifact = ref<ArtifactState | null>(null)
  const isOpen = ref(false)
  const currentMessageId = ref<string | null>(null)
  const currentSessionId = ref<string | null>(null)
  const dismissedContexts = ref(new Set<string>())

  const showArtifact = (
    artifact: ArtifactState,
    messageId: string,
    sessionId: string,
    options?: ShowArtifactOptions
  ) => {
    const contextKey = makeContextKey(artifact.id, messageId, sessionId)

    if (!options?.force && dismissedContexts.value.has(contextKey)) {
      return
    }

    if (options?.force) {
      dismissedContexts.value.delete(contextKey)
    }

    currentArtifact.value = artifact
    currentMessageId.value = messageId
    currentSessionId.value = sessionId
    isOpen.value = true
  }

  const hideArtifact = () => {
    currentArtifact.value = null
    currentMessageId.value = null
    currentSessionId.value = null
    isOpen.value = false
  }

  const dismissArtifact = () => {
    if (currentArtifact.value && currentMessageId.value && currentSessionId.value) {
      const contextKey = makeContextKey(
        currentArtifact.value.id,
        currentMessageId.value,
        currentSessionId.value
      )
      dismissedContexts.value.add(contextKey)
    }
    hideArtifact()
  }

  const validateContext = (messageId: string, sessionId: string) => {
    return currentMessageId.value === messageId && currentSessionId.value === sessionId
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
    currentSessionId,
    isOpen,
    showArtifact,
    hideArtifact,
    dismissArtifact,
    validateContext,
    updateArtifactContent
  }
})
