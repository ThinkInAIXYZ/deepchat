import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useSidepanelStore } from './ui/sidepanel'

export interface ArtifactState {
  id: string
  type: string
  title: string
  content: string
  status: 'loading' | 'loaded' | 'error'
  language?: string
}

const makeContextKey = (artifactId: string, messageId: string, threadId: string) =>
  `${threadId}:${messageId}:${artifactId}`

interface ShowArtifactOptions {
  force?: boolean
  open?: boolean
  viewMode?: 'preview' | 'code'
}

export const useArtifactStore = defineStore('artifact', () => {
  const sidepanelStore = useSidepanelStore()
  const currentArtifact = ref<ArtifactState | null>(null)
  const currentMessageId = ref<string | null>(null)
  const currentThreadId = ref<string | null>(null)
  const dismissedContexts = ref(new Set<string>())
  const completedContexts = ref(new Set<string>())

  const isOpen = computed(() => {
    if (!currentArtifact.value || !currentThreadId.value) {
      return false
    }

    const sessionState = sidepanelStore.getSessionState(currentThreadId.value)
    return (
      sidepanelStore.open &&
      sidepanelStore.activeTab === 'workspace' &&
      sessionState.selectedArtifactContext?.artifactId === currentArtifact.value.id
    )
  })

  const applyArtifactSelection = (
    artifact: ArtifactState,
    messageId: string,
    threadId: string,
    options?: ShowArtifactOptions
  ) => {
    currentArtifact.value = artifact
    currentMessageId.value = messageId
    currentThreadId.value = threadId
    sidepanelStore.selectArtifact(
      threadId,
      {
        threadId,
        messageId,
        artifactId: artifact.id
      },
      {
        open: options?.open,
        viewMode: options?.viewMode ?? 'preview'
      }
    )
  }

  const showArtifact = (
    artifact: ArtifactState,
    messageId: string,
    threadId: string,
    options?: ShowArtifactOptions
  ) => {
    const contextKey = makeContextKey(artifact.id, messageId, threadId)

    if (!options?.force && dismissedContexts.value.has(contextKey)) {
      return
    }

    if (options?.force) {
      dismissedContexts.value.delete(contextKey)
    }

    applyArtifactSelection(artifact, messageId, threadId, {
      open: options?.open ?? true,
      viewMode: options?.viewMode ?? 'preview'
    })
  }

  const hideArtifact = () => {
    const threadId = currentThreadId.value
    currentArtifact.value = null
    currentMessageId.value = null
    currentThreadId.value = null
    if (threadId) {
      sidepanelStore.clearArtifact(threadId)
    }
  }

  const dismissArtifact = () => {
    if (currentArtifact.value && currentMessageId.value && currentThreadId.value) {
      const contextKey = makeContextKey(
        currentArtifact.value.id,
        currentMessageId.value,
        currentThreadId.value
      )
      dismissedContexts.value.add(contextKey)
    }
    hideArtifact()
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

  const syncArtifact = (artifact: ArtifactState, messageId: string, threadId: string) => {
    if (!currentArtifact.value || validateContext(messageId, threadId)) {
      currentArtifact.value = artifact
      currentMessageId.value = messageId
      currentThreadId.value = threadId
    }
  }

  const completeArtifact = (artifact: ArtifactState, messageId: string, threadId: string) => {
    const contextKey = makeContextKey(artifact.id, messageId, threadId)
    const panelWasHidden = !sidepanelStore.open
    const currentMatches =
      validateContext(messageId, threadId) && currentArtifact.value?.id === artifact.id

    syncArtifact(artifact, messageId, threadId)

    if (currentMatches) {
      sidepanelStore.setViewMode(threadId, 'preview')
    }

    if (completedContexts.value.has(contextKey)) {
      return
    }

    completedContexts.value.add(contextKey)

    if (panelWasHidden && !dismissedContexts.value.has(contextKey)) {
      applyArtifactSelection(artifact, messageId, threadId, {
        open: true,
        viewMode: 'preview'
      })
    }
  }

  return {
    currentArtifact,
    currentMessageId,
    currentThreadId,
    isOpen,
    showArtifact,
    hideArtifact,
    dismissArtifact,
    validateContext,
    updateArtifactContent,
    syncArtifact,
    completeArtifact
  }
})
