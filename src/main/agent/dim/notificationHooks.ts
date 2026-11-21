import { RuntimeHookSink } from '@/agent/shared/resources/sessionHooks'
import type { HookObserver } from '@/hook/observer'
import type { SessionDatabase } from '@/session/data/database'
import type {
  AssistantMessageBlock,
  MessageMetadata,
  UserMessageContent
} from '@shared/types/agent-interface'
import type { DimProjection } from './messageProjection'

export function observeDimNotificationHooks(database: SessionDatabase, observer: HookObserver) {
  const sink = new RuntimeHookSink({
    observer,
    identity: { getAgentId: (id) => database.newSessionsTable.get(id)?.agent_id },
    sessionSettings: {
      resolveProjectDir: (id) => database.newSessionsTable.get(id)?.project_dir ?? null
    }
  })
  const startedAt = Date.now()
  const pendingStarts = new Map<string, string>()

  return ({ event, binding, messages, completed, resetTranscript }: DimProjection): void => {
    const { sessionId, activeTurnId, assistantMessageId } = binding
    if (resetTranscript) pendingStarts.delete(sessionId)
    if (!event || event.create_at < startedAt) return

    const kind = `${event.type}/${event.name}`
    if (kind === 'turn/start' && activeTurnId) {
      if (observer.isObserved('SessionStart')) pendingStarts.set(sessionId, activeTurnId)
      return
    }
    if (!activeTurnId && !completed) return

    const scope = (messageId?: string | null) => {
      const session = database.deepchatSessionsTable.get(sessionId)
      return sink.scope({
        sessionId,
        messageId: messageId ?? undefined,
        providerId: session?.provider_id,
        modelId: session?.model_id
      })
    }
    const user = kind === 'input/consumed' ? messages.find((item) => item.role === 'user') : null
    const promptPreview = user && (JSON.parse(user.content) as UserMessageContent).text
    if (user && observer.isObserved('UserPromptSubmit'))
      scope(user.id).emit({ event: 'UserPromptSubmit', promptPreview: promptPreview ?? '' })

    if (
      pendingStarts.get(sessionId) === (activeTurnId ?? completed?.requestId) &&
      (user || kind === 'step/model-start' || completed)
    ) {
      pendingStarts.delete(sessionId)
      scope(assistantMessageId ?? completed?.messageId).emit({
        event: 'SessionStart',
        promptPreview: promptPreview ?? undefined
      })
    }

    if (completed) {
      if (!observer.isObserved('Stop') && !observer.isObserved('SessionEnd')) return
      const terminal = messages.find((item) => item.id === completed.messageId)
      if (!terminal) return
      const metadata = JSON.parse(terminal.metadata) as MessageMetadata
      scope(terminal.id).terminal({
        reason: metadata.runStopReason ?? (completed.error ? 'error' : 'complete'),
        userStop: metadata.runOutcome === 'aborted',
        error: completed.error ? { message: completed.error } : null,
        usage: Object.fromEntries(
          (
            [
              'inputTokens',
              'outputTokens',
              'totalTokens',
              'cachedInputTokens',
              'cacheWriteInputTokens'
            ] as const
          ).flatMap((key) => (typeof metadata[key] === 'number' ? [[key, metadata[key]]] : []))
        )
      })
      return
    }

    if (kind === 'approval/request' && observer.isObserved('PermissionRequest')) {
      const { call, source, approval_id: approvalId, reason } = event.data
      if (
        call &&
        typeof call === 'object' &&
        !Array.isArray(call) &&
        typeof call.name === 'string'
      ) {
        const callId =
          source && typeof source === 'object' && !Array.isArray(source)
            ? source.call_id
            : approvalId
        scope(assistantMessageId).emit({
          event: 'PermissionRequest',
          tool: {
            callId: typeof callId === 'string' ? callId : undefined,
            name: call.name,
            params: JSON.stringify(call.input ?? {})
          },
          permission: { approvalId, reason }
        })
      }
      return
    }

    const started = kind === 'step/tool-call'
    const settled = kind === 'step/tool-result'
    if (!assistantMessageId || (!started && !settled)) return
    if (
      started
        ? !observer.isObserved('PreToolUse')
        : !observer.isObserved('PostToolUseFailure') && !observer.isObserved('PostToolUse')
    )
      return
    const assistant = messages.find((item) => item.id === assistantMessageId)
    if (!assistant) return
    const batch = started ? event.data.calls : event.data.results
    if (!Array.isArray(batch)) return
    const calls = new Set(
      batch.flatMap((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? [started ? item.id : item.call_id]
          : []
      )
    )
    const hooks = scope(assistantMessageId)
    for (const block of JSON.parse(assistant.content) as AssistantMessageBlock[]) {
      const tool = block.tool_call
      if (
        block.type !== 'tool_call' ||
        !tool?.id ||
        !calls.has(tool.id) ||
        block.extra?.dimRequestId !== event.data.request_id
      )
        continue
      hooks.emit({
        event: started
          ? 'PreToolUse'
          : block.status === 'error'
            ? 'PostToolUseFailure'
            : 'PostToolUse',
        tool: {
          callId: tool.id,
          name: tool.name,
          params: tool.params,
          ...(started
            ? {}
            : block.status === 'error'
              ? { error: tool.response }
              : { response: tool.response })
        }
      })
    }
  }
}
