import type { HookEventName } from '@shared/hooksNotifications'
import type { HookDispatchContext } from './index'

type HookDispatcher = {
  dispatchEvent(event: HookEventName, context: HookDispatchContext): void
}

export type NewSessionHookContext = {
  sessionId: string
  agentId?: string | null
  projectDir?: string | null
  messageId?: string
  promptPreview?: string
  providerId?: string
  modelId?: string
  tool?: HookDispatchContext['tool']
  permission?: HookDispatchContext['permission']
  stop?: HookDispatchContext['stop']
  usage?: HookDispatchContext['usage']
  error?: HookDispatchContext['error']
}

export class NewSessionHooksBridge {
  constructor(private readonly dispatcher: HookDispatcher) {}

  dispatch(event: HookEventName, context: NewSessionHookContext): void {
    this.dispatcher.dispatchEvent(event, {
      conversationId: context.sessionId,
      messageId: context.messageId,
      promptPreview: context.promptPreview,
      providerId: context.providerId,
      modelId: context.modelId,
      agentId: context.agentId ?? null,
      workdir: context.projectDir ?? null,
      tool: context.tool,
      permission: context.permission ?? null,
      stop: context.stop ?? null,
      usage: context.usage ?? null,
      error: context.error ?? null
    })
  }
}
