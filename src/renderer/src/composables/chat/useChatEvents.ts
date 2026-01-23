import { type Ref } from 'vue'
import type { CONVERSATION } from '@shared/presenter'
import { usePresenter } from '@/composables/usePresenter'
import {
  CONVERSATION_EVENTS,
  CONFIG_EVENTS,
  DEEPLINK_EVENTS,
  MEETING_EVENTS,
  STREAM_EVENTS
} from '@/events'
import router from '@/router'
import type { WorkingStatus } from '@/stores/chat'

/**
 * Chat events composable
 * Handles IPC event listeners setup and routing
 */
export function useChatEvents(
  activeThreadId: Ref<string | null>,
  threads: Ref<{ dt: string; dtThreads: CONVERSATION[] }[]>,
  selectedVariantsMap: Ref<Record<string, string>>,
  threadsWorkingStatus: Ref<Map<string, WorkingStatus>>,
  getTabId: () => number,
  setActiveThreadId: (threadId: string | null) => void,
  loadMessages: () => Promise<void>,
  handleMessageEdited: (msgId: string) => Promise<void>,
  handleMeetingInstruction: (data: { prompt: string }) => Promise<void>,
  sendMessage: (content: any) => Promise<void>,
  queueScrollTarget: (conversationId: string, target: any) => void,
  refreshActiveAgentMcpSelections: () => Promise<void>,
  threadManagementComposable: any,
  configComposable: any,
  deeplinkComposable: any,
  variantManagementComposable: any,
  executionAdapter: any
) {
  const tabP = usePresenter('tabPresenter')

  /**
   * Setup all event listeners
   */
  const setupEventListeners = () => {
    // Meeting instruction event
    window.electron.ipcRenderer.on(MEETING_EVENTS.INSTRUCTION, (_, data) => {
      handleMeetingInstruction(data)
    })

    // Thread list update event
    window.electron.ipcRenderer.on(
      CONVERSATION_EVENTS.LIST_UPDATED,
      (_, updatedGroupedList: { dt: string; dtThreads: CONVERSATION[] }[]) => {
        console.log('Received full thread list update from main process.')

        const currentActiveId = activeThreadId.value
        threads.value = updatedGroupedList

        if (currentActiveId) {
          const flatList = updatedGroupedList.flatMap((g) => g.dtThreads)
          const activeThread = flatList.find((thread) => thread.id === currentActiveId)

          if (!activeThread) {
            threadManagementComposable.clearActiveThread()
          } else if (
            !variantManagementComposable.getIsUpdatingVariant() &&
            activeThread.settings.selectedVariantsMap
          ) {
            selectedVariantsMap.value = { ...activeThread.settings.selectedVariantsMap }
          }
        }
      }
    )

    // Thread activation event
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.ACTIVATED, async (_, msg) => {
      if (msg.tabId !== getTabId()) {
        return
      }

      const prevActiveThreadId = activeThreadId.value
      setActiveThreadId(msg.conversationId)
      if (prevActiveThreadId && prevActiveThreadId !== msg.conversationId) {
        threadManagementComposable.clearThreadCachesForTab(prevActiveThreadId)
      }

      if (msg.conversationId) {
        const status = threadsWorkingStatus.value.get(msg.conversationId)
        if (status === 'completed' || status === 'error') {
          threadsWorkingStatus.value.delete(msg.conversationId)
        }
      }

      await configComposable.loadChatConfig()
      await loadMessages()

      tabP.onRendererTabActivated(msg.conversationId)
    })

    // Message edited event
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.MESSAGE_EDITED, (_, msgId: string) => {
      handleMessageEdited(msgId)
    })

    // Thread deactivation event
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.DEACTIVATED, (_, msg) => {
      if (msg.tabId !== getTabId()) {
        return
      }
      const prevActiveThreadId = activeThreadId.value
      setActiveThreadId(null)
      threadManagementComposable.clearThreadCachesForTab(prevActiveThreadId)
    })

    // Scroll to message event
    window.electron.ipcRenderer.on(CONVERSATION_EVENTS.SCROLL_TO_MESSAGE, (_, payload) => {
      if (!payload?.conversationId) {
        return
      }
      queueScrollTarget(payload.conversationId, {
        messageId: payload.messageId,
        childConversationId: payload.childConversationId
      })
    })

    // Model list changed event
    window.electron.ipcRenderer.on(CONFIG_EVENTS.MODEL_LIST_CHANGED, (_, providerId?: string) => {
      if (providerId === 'acp') {
        void refreshActiveAgentMcpSelections()
      }
    })

    // Deeplink start event
    window.electron.ipcRenderer.on(DEEPLINK_EVENTS.START, async (_, data) => {
      console.log(`[Renderer] Tab ${getTabId()} received DEEPLINK_EVENTS.START:`, data)
      const currentRoute = router.currentRoute.value
      if (currentRoute.name !== 'home') {
        await router.push({ name: 'home' })
      }
      if (activeThreadId.value) {
        await threadManagementComposable.clearActiveThread()
      }
      if (data) {
        deeplinkComposable.setDeeplinkData({
          msg: data.msg,
          modelId: data.modelId,
          systemPrompt: data.systemPrompt,
          autoSend: data.autoSend,
          mentions: data.mentions
        })
      }
    })

    // Send initial message command
    window.electron.ipcRenderer.on(
      'command:send-initial-message',
      async (_, data: { userInput: string }) => {
        if (!activeThreadId.value) {
          console.error('Received send-initial-message command but no active thread is set.')
          return
        }

        try {
          await sendMessage({
            text: data.userInput,
            files: [],
            links: [],
            think: false,
            search: false
          })
        } catch (error) {
          console.error('Failed to handle send-initial-message command:', error)
        }
      }
    )
  }

  /**
   * Setup stream event listeners
   */
  const setupStreamEventListeners = () => {
    if (window.electron && window.electron.ipcRenderer) {
      window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.RESPONSE)
      window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.END)
      window.electron.ipcRenderer.removeAllListeners(STREAM_EVENTS.ERROR)

      window.electron.ipcRenderer.on(STREAM_EVENTS.RESPONSE, (_, msg) => {
        executionAdapter.handleStreamResponse(msg)
      })

      window.electron.ipcRenderer.on(STREAM_EVENTS.END, (_, msg) => {
        executionAdapter.handleStreamEnd(msg)
      })

      window.electron.ipcRenderer.on(STREAM_EVENTS.ERROR, (_, msg) => {
        executionAdapter.handleStreamError(msg)
      })
    }
  }

  /**
   * Initialize all event listeners
   */
  const initializeEventListeners = () => {
    console.log(`[Chat Store] Tab ${getTabId()} is mounted. Setting up event listeners.`)
    setupEventListeners()
    setupStreamEventListeners()
    console.log(`[Chat Store] Tab ${getTabId()} sending ready signal`)
    tabP.onRendererTabReady(getTabId())
  }

  return {
    setupEventListeners,
    setupStreamEventListeners,
    initializeEventListeners
  }
}
