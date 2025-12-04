import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { usePresenter } from '@/composables/usePresenter'
import { useChatStore } from './chat'
import { ACP_WORKSPACE_EVENTS } from '@/events'
import type { ACP_PLAN_ENTRY, ACP_FILE_NODE, ACP_TERMINAL_SNIPPET } from '@shared/presenter'

export const useAcpWorkspaceStore = defineStore('acpWorkspace', () => {
  const chatStore = useChatStore()
  const acpWorkspacePresenter = usePresenter('acpWorkspacePresenter')

  // === State ===
  const isOpen = ref(false)
  const isLoading = ref(false)
  const planEntries = ref<ACP_PLAN_ENTRY[]>([])
  const fileTree = ref<ACP_FILE_NODE[]>([])
  const terminalSnippets = ref<ACP_TERMINAL_SNIPPET[]>([])
  const lastSyncedConversationId = ref<string | null>(null)

  // === Computed Properties ===
  const isAcpMode = computed(() => chatStore.chatConfig.providerId === 'acp')

  const currentWorkdir = computed(() => {
    const modelId = chatStore.chatConfig.modelId
    if (!modelId) return null
    return chatStore.chatConfig.acpWorkdirMap?.[modelId] ?? null
  })

  const completedPlanCount = computed(
    () => planEntries.value.filter((e) => e.status === 'completed').length
  )

  const totalPlanCount = computed(() => planEntries.value.length)

  const planProgress = computed(() => {
    if (totalPlanCount.value === 0) return 0
    return Math.round((completedPlanCount.value / totalPlanCount.value) * 100)
  })

  // === Methods ===
  const toggle = () => {
    isOpen.value = !isOpen.value
  }

  const setOpen = (open: boolean) => {
    isOpen.value = open
  }

  const refreshFileTree = async () => {
    const workdir = currentWorkdir.value
    const conversationIdBefore = chatStore.getActiveThreadId()

    if (!workdir) {
      fileTree.value = []
      return
    }

    // Register workdir before reading (security boundary)
    acpWorkspacePresenter.registerWorkdir(workdir)

    isLoading.value = true
    try {
      const result = (await acpWorkspacePresenter.readDirectory(workdir, 3)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        fileTree.value = result
      }
    } catch (error) {
      console.error('[AcpWorkspace] Failed to load file tree:', error)
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        fileTree.value = []
      }
    } finally {
      if (chatStore.getActiveThreadId() === conversationIdBefore) {
        isLoading.value = false
      }
    }
  }

  const refreshPlanEntries = async () => {
    const conversationId = chatStore.getActiveThreadId()
    if (!conversationId) {
      planEntries.value = []
      return
    }

    try {
      const result = (await acpWorkspacePresenter.getPlanEntries(conversationId)) ?? []
      // Guard against race condition: only update if still on the same conversation
      if (chatStore.getActiveThreadId() === conversationId) {
        planEntries.value = result
      }
    } catch (error) {
      console.error('[AcpWorkspace] Failed to load plan entries:', error)
    }
  }

  const toggleFileNode = (node: ACP_FILE_NODE) => {
    node.expanded = !node.expanded
  }

  const clearData = () => {
    planEntries.value = []
    fileTree.value = []
    terminalSnippets.value = []
    lastSyncedConversationId.value = null
  }

  // === Event Listeners ===
  const setupEventListeners = () => {
    // Plan update event
    window.electron.ipcRenderer.on(
      ACP_WORKSPACE_EVENTS.PLAN_UPDATED,
      (_, payload: { conversationId: string; entries: ACP_PLAN_ENTRY[] }) => {
        if (payload.conversationId === chatStore.getActiveThreadId()) {
          planEntries.value = payload.entries
        }
      }
    )

    // Terminal output event
    window.electron.ipcRenderer.on(
      ACP_WORKSPACE_EVENTS.TERMINAL_OUTPUT,
      (_, payload: { conversationId: string; snippet: ACP_TERMINAL_SNIPPET }) => {
        if (payload.conversationId === chatStore.getActiveThreadId()) {
          // Keep latest 10 items
          terminalSnippets.value = [payload.snippet, ...terminalSnippets.value.slice(0, 9)]
        }
      }
    )

    // File change event - refresh file tree
    window.electron.ipcRenderer.on(
      ACP_WORKSPACE_EVENTS.FILES_CHANGED,
      (_, payload: { conversationId: string }) => {
        if (payload.conversationId === chatStore.getActiveThreadId() && isAcpMode.value) {
          refreshFileTree()
        }
      }
    )
  }

  // === Watchers ===
  // Watch for conversation changes
  watch(
    () => chatStore.getActiveThreadId(),
    async (newId) => {
      if (newId !== lastSyncedConversationId.value) {
        lastSyncedConversationId.value = newId ?? null
        if (newId && isAcpMode.value) {
          await Promise.all([refreshPlanEntries(), refreshFileTree()])
        } else {
          clearData()
        }
      }
    }
  )

  // Watch for workdir changes
  watch(
    currentWorkdir,
    (workdir) => {
      if (isAcpMode.value && workdir) {
        refreshFileTree()
      }
    },
    { immediate: true }
  )

  // Watch for ACP mode changes
  watch(
    isAcpMode,
    (isAcp) => {
      if (isAcp) {
        setOpen(true)
        refreshFileTree()
        refreshPlanEntries()
      } else {
        setOpen(false)
        clearData()
      }
    },
    { immediate: true }
  )

  // Initialize event listeners
  setupEventListeners()

  return {
    // State
    isOpen,
    isLoading,
    planEntries,
    fileTree,
    terminalSnippets,
    // Computed
    isAcpMode,
    currentWorkdir,
    completedPlanCount,
    totalPlanCount,
    planProgress,
    // Methods
    toggle,
    setOpen,
    refreshFileTree,
    refreshPlanEntries,
    toggleFileNode,
    clearData
  }
})
