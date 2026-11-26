import { computed, ref, watch } from 'vue'
import { projectPendingInteraction } from '@shared/chat/pendingInteraction'
import { DEEPCHAT_ROUTE_INVOKE_CHANNEL } from '@shared/contracts/channels'
import { staleDimInteractionMessages } from '@shared/dimQuestions'
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
  const { acknowledgedInteractions, inFlightInteractions } = options.messageStore

  watch(
    () => options.messageStore.messages,
    (messages) => {
      const session = options.messageStore.committedSession
      // Child approvals can still appear in an older parent progress snapshot.
      if (
        !acknowledgedInteractions.size ||
        session?.sessionKind !== 'regular' ||
        session.parentSessionId
      )
        return
      for (const message of messages) {
        if (
          message.sessionId === session.id &&
          message.status !== 'pending' &&
          acknowledgedInteractions.get(message.id)?.sessionId === session.id &&
          !options.messageStore.getAssistantMessageBlocks(message).some(projectPendingInteraction)
        )
          acknowledgedInteractions.delete(message.id)
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
    JSON.stringify([
      sessionId,
      messageId,
      toolCallId,
      block.extra?.dimRequestId ?? block.extra?.permissionRequestId
    ])

  const markStale = (interaction: PendingInteractionView) => {
    const key = interactionKey(interaction)
    if (staleInteractionKeys.value.has(key)) return
    staleInteractionKeys.value = new Set(staleInteractionKeys.value).add(key)
  }

  const pendingInteractions = computed<PendingInteractionView[]>(() => {
    const list: PendingInteractionView[] = []

    for (const message of options.messageStore.messages) {
      if (message.role !== 'assistant' || message.sessionId !== options.sessionId()) continue
      const blocks = options.messageStore.getAssistantMessageBlocks(message)

      for (const block of blocks) {
        const pending = projectPendingInteraction(block)
        if (!pending) continue

        list.push({
          sessionId: message.sessionId,
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
        !acknowledgedInteractions.get(entry.messageId)?.keys.has(key)
      )
    })
  })

  const activePendingInteraction = computed(() => pendingInteractions.value[0] ?? null)

  const isHandlingInteraction = computed(() => {
    const interaction = activePendingInteraction.value
    return (
      [...inFlightInteractions.values()].some(
        (entry) => entry.displaySessionId === options.sessionId()
      ) ||
      (interaction !== null && inFlightInteractions.has(interactionKey(interaction)))
    )
  })

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
    const key = interactionKey(interaction)
    const token = Symbol()
    inFlightInteractions.set(key, {
      sessionId: interaction.sessionId,
      messageId: interaction.messageId,
      displaySessionId: sessionId,
      token
    })
    const ownsSubmission = () => inFlightInteractions.get(key)?.token === token
    const isCurrentView = () => options.canWriteSessionView(sessionId, requestId)
    try {
      const permissionRequestId = interaction.block.extra?.permissionRequestId
      const result = await options.chatClient.respondToolInteraction({
        sessionId: interaction.sessionId,
        messageId: interaction.messageId,
        toolCallId: interaction.toolCallId,
        response:
          response.kind === 'permission' &&
          typeof permissionRequestId === 'string' &&
          permissionRequestId
            ? { ...response, permissionRequestId }
            : response
      })
      if (!ownsSubmission()) return
      if (
        isNativeQuestion ||
        (interaction.actionType === 'tool_call_permission' &&
          (result.resumed || result.handledInline))
      ) {
        const keys = new Set(acknowledgedInteractions.get(interaction.messageId)?.keys)
        acknowledgedInteractions.set(interaction.messageId, {
          sessionId: interaction.sessionId,
          keys: keys.add(key)
        })
      }
    } catch (error) {
      if (!ownsSubmission()) return
      console.error('[ChatPage] respond tool interaction failed:', error)
      options.onResponseFailed?.(interaction, error)
      if (isStaleDimInteraction(error)) markStale(interaction)
    } finally {
      if (ownsSubmission() && !isNativeQuestion && isCurrentView()) {
        try {
          const restoredSession = await options.loadMessagesForSession(sessionId)
          if (ownsSubmission() && isCurrentView())
            options.applyRestoredSessionSummary(restoredSession)
        } catch (refreshError) {
          console.error('[ChatPage] refresh after tool interaction response failed:', refreshError)
        }
      }
      if (ownsSubmission()) inFlightInteractions.delete(key)
    }
  }

  return {
    pendingInteractions,
    activePendingInteraction,
    isHandlingInteraction,
    onToolInteractionRespond
  }
}
