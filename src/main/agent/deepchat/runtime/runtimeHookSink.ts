import type { DeepChatSessionState } from '@shared/types/agent-interface'
import type {
  HookErrorFacts,
  HookEventBody,
  HookSessionFacts,
  HookUsageFacts
} from '@/hook/events'
import type { HookObserver } from '@/hook/observer'
import type {
  DeepChatLoopNotification,
  DeepChatLoopNotificationObserver
} from '@/agent/deepchat/loop/ports'
import type { ProcessResult } from './types'
import type { SessionIdentityService } from './sessionIdentityService'
import type { SessionSettingsCoordinator } from './sessionSettingsCoordinator'

export interface RuntimeHookSinkDependencies {
  observer: HookObserver
  onSessionCompleted?: (sessionId: string) => void
  identity: Pick<SessionIdentityService, 'getAgentId'>
  sessionSettings: Pick<SessionSettingsCoordinator, 'resolveProjectDir'>
}

export interface RuntimeHookScopeInput {
  readonly sessionId: string
  readonly messageId?: string
  readonly providerId?: string
  readonly modelId?: string
  /** Omit to resolve from session settings; pass null to state that the session has none. */
  readonly projectDir?: string | null
}

export interface RuntimeTerminalFacts {
  readonly completed?: boolean
  readonly reason?: string
  readonly userStop: boolean
  readonly usage?: HookUsageFacts | null
  readonly error?: HookErrorFacts | null
}

export class RuntimeHookScope {
  private facts: HookSessionFacts | undefined

  constructor(
    private readonly deps: RuntimeHookSinkDependencies,
    private readonly input: RuntimeHookScopeInput
  ) {}

  emit(body: HookEventBody): void {
    try {
      if (!this.deps.observer.isObserved(body.event)) {
        return
      }
      this.deps.observer.notify({ ...body, session: this.sessionFacts() })
    } catch (error) {
      console.warn(`[DeepChatAgent] Failed to dispatch ${body.event} hook:`, error)
    }
  }

  /** The single terminal projection: every settled turn reports Stop then SessionEnd. */
  terminal(facts: RuntimeTerminalFacts): void {
    this.emit({ event: 'Stop', stop: { reason: facts.reason, userStop: facts.userStop } })
    this.emit({ event: 'SessionEnd', usage: facts.usage ?? null, error: facts.error ?? null })
    if (facts.completed && !facts.userStop && !facts.error) {
      try {
        this.deps.onSessionCompleted?.(this.input.sessionId)
      } catch (error) {
        console.warn('[DeepChatAgent] Failed to notify session completion:', error)
      }
    }
  }

  toolObserver(): DeepChatLoopNotificationObserver {
    return {
      isObserved: (event) => this.deps.observer.isObserved(event),
      notify: (notification: DeepChatLoopNotification) => {
        this.emit(
          notification.event === 'PermissionRequest'
            ? {
                event: 'PermissionRequest',
                tool: notification.tool,
                permission: notification.permission
              }
            : { event: notification.event, tool: notification.tool }
        )
      }
    }
  }

  private sessionFacts(): HookSessionFacts {
    this.facts ??= {
      sessionId: this.input.sessionId,
      messageId: this.input.messageId,
      providerId: this.input.providerId,
      modelId: this.input.modelId,
      projectDir:
        this.input.projectDir !== undefined ? this.input.projectDir : this.resolveProjectDir(),
      agentId: this.deps.identity.getAgentId(this.input.sessionId) ?? 'deepchat'
    }
    return this.facts
  }

  /** Leaves the directory unanswered on failure so delivery can still resolve it from the session. */
  private resolveProjectDir(): string | null | undefined {
    try {
      return this.deps.sessionSettings.resolveProjectDir(this.input.sessionId)
    } catch (error) {
      console.warn('[DeepChatAgent] Failed to resolve hook project directory:', error)
      return undefined
    }
  }
}

export class RuntimeHookSink {
  constructor(private readonly deps: RuntimeHookSinkDependencies) {}

  scope(input: RuntimeHookScopeInput): RuntimeHookScope {
    return new RuntimeHookScope(this.deps, input)
  }

  observeTerminal(
    sessionId: string,
    state: DeepChatSessionState | undefined,
    result: ProcessResult
  ): void {
    if (!state || result.status === 'paused') {
      return
    }

    this.scope({ sessionId, providerId: state.providerId, modelId: state.modelId }).terminal({
      completed: result.status === 'completed',
      reason:
        result.stopReason ??
        (result.status === 'completed'
          ? 'complete'
          : result.status === 'aborted'
            ? 'user_stop'
            : 'error'),
      userStop: result.status === 'aborted',
      usage: result.usage ?? null,
      error:
        result.errorMessage || result.terminalError
          ? { message: result.errorMessage ?? result.terminalError }
          : null
    })
  }
}
