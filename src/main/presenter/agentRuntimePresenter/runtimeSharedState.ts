import type { DeepChatSessionState } from '@shared/types/agent-interface'

export type ActiveGeneration = {
  runId: string
  messageId: string
  abortController: AbortController
}

export class RuntimeSharedState {
  readonly runtimeState = new Map<string, DeepChatSessionState>()
  readonly abortControllers = new Map<string, AbortController>()
  readonly deferredToolAbortControllers = new Map<string, AbortController>()
  readonly activeGenerations = new Map<string, ActiveGeneration>()
  readonly activeSteerPendingInputIds = new Map<string, string>()
  readonly drainingPendingQueues = new Set<string>()
}
