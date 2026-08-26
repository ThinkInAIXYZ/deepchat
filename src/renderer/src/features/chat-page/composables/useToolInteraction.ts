import { computed, ref } from 'vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import type { useMessageStore } from '@/stores/ui/message'
import type { ToolInteractionResponse, ToolInteractionResult } from '@shared/types/agent-interface'

type MessageStore = ReturnType<typeof useMessageStore>

type PendingInteractionView = {
  sessionId: string
  messageId: string
  toolCallId: string
  actionType: 'question_request' | 'tool_call_permission'
  toolName: string
  toolArgs: string
  block: DisplayAssistantMessageBlock
}

type SubagentProgressPayload = {
  tasks?: Array<{
    sessionId?: string | null
    waitingInteraction?: {
      type: 'permission' | 'question'
      messageId: string
      toolCallId: string
      actionBlock: DisplayAssistantMessageBlock
    } | null
  }>
}

type ChatClientLike = {
  respondToolInteraction: (input: {
    sessionId: string
    messageId: string
    toolCallId: string
    response: ToolInteractionResponse
  }) => Promise<ToolInteractionResult>
  dismissToolInteraction: (input: {
    sessionId: string
    messageId: string
    toolCallId: string
  }) => Promise<{ dismissed: boolean }>
}

type UseToolInteractionOptions = {
  sessionId: () => string
  messageStore: MessageStore
  chatClient: ChatClientLike
  loadMessagesForSession: (sessionId: string) => Promise<unknown>
  applyRestoredSessionSummary: (session: unknown) => void
  currentRestoreRequestId: () => number
  canWriteSessionView: (sessionId: string, requestId: number) => boolean
}

function parseSubagentProgress(value: unknown): SubagentProgressPayload | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value) as SubagentProgressPayload
    return Array.isArray(parsed?.tasks) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Owns pending tool/question interaction discovery and response submission.
 * It preserves the page's current-session refresh semantics after a response,
 * while the page composes the returned state into its plan and composer gates.
 */
export function useToolInteraction(options: UseToolInteractionOptions) {
  const isHandlingInteraction = ref(false)

  // Interactions the main process could not resolve (their backing run is gone,
  // the session was replaced mid-response, or the subagent session vanished).
  // Keeping them in the list would trap the approval UI on an interaction that
  // can never close and block access to newer pending approvals.
  const staleInteractionKeys = ref<Set<string>>(new Set())

  const interactionKey = (interaction: {
    sessionId: string
    messageId: string
    toolCallId: string
  }) => `${interaction.sessionId}:${interaction.messageId}:${interaction.toolCallId}`

  const markStale = (interaction: { sessionId: string; messageId: string; toolCallId: string }) => {
    const key = interactionKey(interaction)
    if (staleInteractionKeys.value.has(key)) return
    staleInteractionKeys.value = new Set(staleInteractionKeys.value).add(key)
  }

  const pendingInteractions = computed<PendingInteractionView[]>(() => {
    const list: PendingInteractionView[] = []

    for (const message of options.messageStore.messages) {
      if (message.role !== 'assistant') continue
      const blocks = options.messageStore.getAssistantMessageBlocks(message)

      for (const block of blocks) {
        if (
          block.type !== 'action' ||
          (block.action_type !== 'question_request' &&
            block.action_type !== 'tool_call_permission') ||
          block.status !== 'pending' ||
          block.extra?.needsUserAction === false
        ) {
          continue
        }

        const toolCallId = block.tool_call?.id
        if (!toolCallId) {
          continue
        }

        list.push({
          sessionId: options.sessionId(),
          messageId: message.id,
          toolCallId,
          actionType: block.action_type,
          toolName: block.tool_call?.name || '',
          toolArgs: block.tool_call?.params || '',
          block
        })
      }

      for (const block of blocks) {
        if (block.type !== 'tool_call' || block.tool_call?.name !== 'subagent_orchestrator') {
          continue
        }

        const progress = parseSubagentProgress(block.extra?.subagentProgress)
        if (!progress?.tasks?.length) {
          continue
        }

        for (const task of progress.tasks) {
          const waiting = task.waitingInteraction
          if (!waiting?.actionBlock || !task.sessionId) {
            continue
          }

          list.push({
            sessionId: task.sessionId,
            messageId: waiting.messageId,
            toolCallId: waiting.toolCallId,
            actionType: waiting.type === 'question' ? 'question_request' : 'tool_call_permission',
            toolName: waiting.actionBlock.tool_call?.name || block.tool_call?.name || '',
            toolArgs: waiting.actionBlock.tool_call?.params || '',
            block: waiting.actionBlock
          })
        }
      }
    }

    if (staleInteractionKeys.value.size === 0) {
      return list
    }

    const stale = staleInteractionKeys.value
    return list.filter((entry) => !stale.has(interactionKey(entry)))
  })

  const activePendingInteraction = computed(() => pendingInteractions.value[0] ?? null)

  async function onToolInteractionRespond(response: ToolInteractionResponse) {
    const interaction = activePendingInteraction.value
    if (!interaction || isHandlingInteraction.value) {
      return
    }

    const sessionId = options.sessionId()
    const requestId = options.currentRestoreRequestId()
    isHandlingInteraction.value = true
    const isCurrentView = () => options.canWriteSessionView(sessionId, requestId)
    const refreshAfterResponse = async () => {
      if (!isCurrentView()) return false
      const restoredSession = await options.loadMessagesForSession(sessionId)
      if (!isCurrentView()) return false
      options.applyRestoredSessionSummary(restoredSession)
      return true
    }
    const isStillPending = () =>
      pendingInteractions.value.some(
        (entry) => interactionKey(entry) === interactionKey(interaction)
      )
    // Best-effort durable close on the main-process transcript so the orphaned
    // block stops blocking new turns and does not reappear after a session reload.
    const dismissStale = async () => {
      if (!isStillPending()) return
      markStale(interaction)
      try {
        await options.chatClient.dismissToolInteraction({
          sessionId: interaction.sessionId,
          messageId: interaction.messageId,
          toolCallId: interaction.toolCallId
        })
      } catch (error) {
        console.error('[ChatPage] dismiss stale tool interaction failed:', error)
      }
    }
    try {
      const result = await options.chatClient.respondToolInteraction({
        sessionId: interaction.sessionId,
        messageId: interaction.messageId,
        toolCallId: interaction.toolCallId,
        response
      })
      const refreshed = await refreshAfterResponse()
      if (!refreshed || result.handledInline || result.waitingForUserMessage) {
        return
      }
      // The main process resolves a handled interaction by persisting a
      // non-pending block status. If it is still pending after the reload, its
      // backing run is gone and the approval can never be closed here. Drop it
      // so the UI advances to the next pending approval instead of staying stuck.
      await dismissStale()
    } catch (error) {
      console.error('[ChatPage] respond tool interaction failed:', error)
      // A rejected respond is itself a strong staleness signal (a resolvable
      // interaction would not be rejected). Reload once and, if the interaction
      // is still pending, release the UI from the uncloseable approval.
      try {
        const refreshed = await refreshAfterResponse()
        if (refreshed) {
          await dismissStale()
        }
      } catch (refreshError) {
        console.error('[ChatPage] refresh after failed tool interaction response:', refreshError)
      }
    } finally {
      isHandlingInteraction.value = false
    }
  }

  return {
    pendingInteractions,
    activePendingInteraction,
    isHandlingInteraction,
    onToolInteractionRespond
  }
}
