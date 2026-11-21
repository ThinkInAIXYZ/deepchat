import { computed, ref, shallowReactive, watch } from 'vue'
import { projectPendingInteraction } from '@shared/chat/pendingInteraction'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { staleDimInteractionMessages } from '@shared/dimQuestions'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import type { useMessageStore } from '@/stores/ui/message'
import type { ToolInteractionResponse, ToolInteractionResult } from '@shared/types/agent-interface'

type MessageStore = ReturnType<typeof useMessageStore>

// Answers may still be awaiting their batch result when the chat page is remounted.
const answeredNativeQuestions = shallowReactive(new Map<string, Set<string>>())

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
  /** Reports a response the main process refused to accept. */
  onResponseFailed?: (interaction: PendingInteractionView, error: unknown) => void
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

function isStaleDimInteraction(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const prefix = `Error invoking remote method '${DEEPCHAT_ROUTE_INVOKE_CHANNEL}': Error: `
  return Object.values(staleDimInteractionMessages).some(
    (message) => error.message === message || error.message === prefix + message
  )
}

/**
 * Owns pending tool/question interaction discovery and response submission.
 * It preserves the page's current-session refresh semantics after a response,
 * while the page composes the returned state into its plan and composer gates.
 */
export function useToolInteraction(options: UseToolInteractionOptions) {
  const isHandlingInteraction = ref(false)

  watch(
    () => options.messageStore.messages,
    (messages) => {
      if (answeredNativeQuestions.size === 0) return
      for (const message of messages) {
        if (message.status !== 'pending') answeredNativeQuestions.delete(message.id)
      }
    },
    { immediate: true }
  )

  // Interactions the main process could not resolve (their backing run is gone,
  // the session was replaced mid-response, or the subagent session vanished).
  // Keeping them in the list would trap the approval UI on an interaction that
  // can never close and block access to newer pending approvals.
  const staleInteractionKeys = ref<Set<string>>(new Set())

  const interactionKey = ({ sessionId, messageId, toolCallId, block }: PendingInteractionView) =>
    `${sessionId}:${messageId}:${toolCallId}:${block.extra?.dimRequestId ?? ''}`

  const markStale = (interaction: PendingInteractionView) => {
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
        const pending = projectPendingInteraction(block)
        if (!pending) continue

        list.push({
          sessionId: options.sessionId(),
          messageId: message.id,
          ...pending,
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

    return list.filter((entry) => {
      const key = interactionKey(entry)
      return (
        !staleInteractionKeys.value.has(key) &&
        !answeredNativeQuestions.get(entry.messageId)?.has(key)
      )
    })
  })

  const activePendingInteraction = computed(() => pendingInteractions.value[0] ?? null)

  async function onToolInteractionRespond(response: ToolInteractionResponse) {
    const interaction = activePendingInteraction.value
    if (!interaction || isHandlingInteraction.value) {
      return
    }

    const sessionId = options.sessionId()
    const requestId = options.currentRestoreRequestId()
    const isNativeQuestion =
      interaction.actionType === 'question_request' &&
      typeof interaction.block.extra?.dimRequestId === 'string'
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
      if (isNativeQuestion) {
        // The batch result can be blocked on a sibling question that the dock must show next.
        if (!isCurrentView() || isStillPending()) {
          const { messageId } = interaction
          const keys = new Set(answeredNativeQuestions.get(messageId))
          answeredNativeQuestions.set(messageId, keys.add(interactionKey(interaction)))
        }
        return
      }
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
      options.onResponseFailed?.(interaction, error)
      if (isNativeQuestion) {
        if (isStaleDimInteraction(error)) markStale(interaction)
        return
      }
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
