import type { HookEventName } from '@shared/hooksNotifications'
import type { HookDispatchContext } from './index'

export type HookContext = Readonly<{
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

export interface HookNotification {
  readonly event: HookEventName
  readonly context: HookContext
}

export interface HookObserver {
  notify(notification: HookNotification): void
}
