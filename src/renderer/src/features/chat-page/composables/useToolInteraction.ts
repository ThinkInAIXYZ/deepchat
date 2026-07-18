import { computed, ref, type ComputedRef } from 'vue'
import type { DisplayAssistantMessageBlock } from '@/features/chat-page/model/displayMessage'
import type { useMessageStore } from '@/stores/ui/message'
import type { ToolInteractionResponse } from '@shared/types/agent-interface'

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
  }) => Promise<{ handledInline?: boolean }>
}

type UseToolInteractionOptions = {
  sessionId: () => string
  messageStore: MessageStore
  isReadOnlySession: ComputedRef<boolean>
  chatClient: ChatClientLike
  loadMessagesForSession: (sessionId: string) => Promise<unknown>
  applyRestoredSessionSummary: (session: unknown) => void
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

    return list
  })

  const activePendingInteraction = computed(() => pendingInteractions.value[0] ?? null)

  async function onToolInteractionRespond(response: ToolInteractionResponse) {
    if (options.isReadOnlySession.value) {
      return
    }

    const interaction = activePendingInteraction.value
    if (!interaction || isHandlingInteraction.value) {
      return
    }

    isHandlingInteraction.value = true
    try {
      const result = await options.chatClient.respondToolInteraction({
        sessionId: interaction.sessionId,
        messageId: interaction.messageId,
        toolCallId: interaction.toolCallId,
        response
      })
      options.applyRestoredSessionSummary(await options.loadMessagesForSession(options.sessionId()))
      if (result.handledInline) {
        return
      }
    } catch (error) {
      console.error('[ChatPage] respond tool interaction failed:', error)
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
