import type { HookEventName } from '@shared/hooksNotifications'
import type { HookDispatchContext } from './index'

type HookDispatcher = {
  dispatchEvent(event: HookEventName, context: HookDispatchContext): void | PromiseLike<void>
}

export type NewSessionHookContext = Readonly<{
  sessionId: string
  agentId?: string | null
  projectDir?: string | null
  messageId?: string
  promptPreview?: string
  providerId?: string
  modelId?: string
  tool?: Readonly<NonNullable<HookDispatchContext['tool']>>
  permission?: Readonly<Record<string, unknown>> | null
  stop?: Readonly<NonNullable<HookDispatchContext['stop']>> | null
  usage?: Readonly<Record<string, number>> | null
  error?: Readonly<NonNullable<HookDispatchContext['error']>> | null
}>

export interface NewSessionHookNotification {
  readonly event: HookEventName
  readonly context: NewSessionHookContext
}

export interface NewSessionHookNotificationObserver {
  notify(notification: NewSessionHookNotification): void
}

export class NewSessionHooksBridge implements NewSessionHookNotificationObserver {
  constructor(private readonly dispatcher: HookDispatcher) {}

  notify(notification: NewSessionHookNotification): void {
    try {
      const context = structuredClone(notification.context)
      const pending = this.dispatcher.dispatchEvent(notification.event, {
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
      if (pending) {
        void Promise.resolve(pending).catch((error) => {
          console.warn('[NewSessionHooksBridge] Notification observer failed:', error)
        })
      }
    } catch (error) {
      console.warn('[NewSessionHooksBridge] Notification observer failed:', error)
    }
  }
}
