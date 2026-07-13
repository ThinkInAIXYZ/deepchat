import type { ActiveGeneration, RuntimeSharedState } from './runtimeSharedState'
import { nanoid } from 'nanoid'

export type GenerationActivity = 'active' | 'preparing' | 'idle'

export class GenerationControlService {
  constructor(
    private readonly runtimeSharedState: RuntimeSharedState,
    private readonly cancelProviderPermissions: (sessionId: string) => void,
    private readonly createRunToken: () => string = nanoid
  ) {}

  cancelGeneration(sessionId: string): void {
    // Stream handlers retain terminal-settlement ownership. Cancellation only requests aborts and
    // releases interactions that cannot outlive the canceled turn.
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    if (activeGeneration) {
      activeGeneration.abortController.abort()
    } else {
      const controller = this.runtimeSharedState.abortControllers.get(sessionId)
      if (controller) {
        controller.abort()
        this.runtimeSharedState.abortControllers.delete(sessionId)
      }
    }
    this.abortDeferredToolControllers(sessionId)
    this.cancelProviderPermissions(sessionId)
  }

  getActiveGeneration(sessionId: string): { eventId: string; runId: string } | null {
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    if (!activeGeneration) return null
    return {
      eventId: activeGeneration.messageId,
      runId: activeGeneration.runId
    }
  }

  cancelGenerationByEventId(sessionId: string, eventId: string): boolean {
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    if (!activeGeneration || activeGeneration.messageId !== eventId) return false
    this.cancelGeneration(sessionId)
    return true
  }

  getGenerationActivity(sessionId: string): GenerationActivity {
    if (this.runtimeSharedState.activeGenerations.has(sessionId)) return 'active'
    if (this.runtimeSharedState.abortControllers.has(sessionId)) return 'preparing'
    return 'idle'
  }

  getAbortSignal(sessionId: string): AbortSignal | undefined {
    return (
      this.runtimeSharedState.activeGenerations.get(sessionId)?.abortController.signal ??
      this.runtimeSharedState.abortControllers.get(sessionId)?.signal
    )
  }

  ensureSessionAbortController(sessionId: string): AbortController {
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    if (activeGeneration) {
      if (!activeGeneration.abortController.signal.aborted) {
        return activeGeneration.abortController
      }
      this.clearActiveGeneration(sessionId, activeGeneration.runId)
    }

    const existing = this.runtimeSharedState.abortControllers.get(sessionId)
    existing?.abort()

    const controller = new AbortController()
    this.runtimeSharedState.abortControllers.set(sessionId, controller)
    return controller
  }

  clearSessionAbortController(sessionId: string, controller?: AbortController): void {
    const current = this.runtimeSharedState.abortControllers.get(sessionId)
    if (!current || (controller && current !== controller)) return
    this.runtimeSharedState.abortControllers.delete(sessionId)
  }

  registerActiveGeneration(
    sessionId: string,
    messageId: string,
    abortController: AbortController
  ): ActiveGeneration {
    const generation: ActiveGeneration = {
      runId: `${sessionId}:${this.createRunToken()}`,
      messageId,
      abortController
    }
    this.runtimeSharedState.activeGenerations.set(sessionId, generation)
    this.runtimeSharedState.abortControllers.set(sessionId, abortController)
    return generation
  }

  clearActiveGeneration(sessionId: string, runId: string): void {
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    if (!activeGeneration || activeGeneration.runId !== runId) return

    this.runtimeSharedState.activeGenerations.delete(sessionId)
    this.cancelProviderPermissions(sessionId)
    if (
      this.runtimeSharedState.abortControllers.get(sessionId) === activeGeneration.abortController
    ) {
      this.runtimeSharedState.abortControllers.delete(sessionId)
    }
  }

  isActiveRun(sessionId: string, runId: string): boolean {
    return this.runtimeSharedState.activeGenerations.get(sessionId)?.runId === runId
  }

  shouldSetIdleAfterAbort(sessionId: string, runId?: string): boolean {
    return this.shouldApplyTerminalStatus(sessionId, runId)
  }

  shouldApplyTerminalStatus(
    sessionId: string,
    runId?: string,
    controller?: AbortController
  ): boolean {
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    const currentController = this.runtimeSharedState.abortControllers.get(sessionId)
    if (runId && activeGeneration?.runId === runId) {
      return true
    }
    if (activeGeneration) {
      return false
    }
    if (currentController) {
      return Boolean(controller && currentController === controller)
    }
    return true
  }

  resolveStreamRequestId(sessionId: string, messageId: string): string {
    const activeGeneration = this.runtimeSharedState.activeGenerations.get(sessionId)
    return activeGeneration?.messageId === messageId ? activeGeneration.runId : messageId
  }

  registerDeferredToolController(sessionId: string, toolCallId: string): AbortController {
    const key = this.buildDeferredToolKey(sessionId, toolCallId)
    this.runtimeSharedState.deferredToolAbortControllers.get(key)?.abort()
    const controller = new AbortController()
    this.runtimeSharedState.deferredToolAbortControllers.set(key, controller)
    return controller
  }

  clearDeferredToolController(
    sessionId: string,
    toolCallId: string,
    controller?: AbortController
  ): void {
    const key = this.buildDeferredToolKey(sessionId, toolCallId)
    const current = this.runtimeSharedState.deferredToolAbortControllers.get(key)
    if (!current || (controller && current !== controller)) return
    this.runtimeSharedState.deferredToolAbortControllers.delete(key)
  }

  abortDeferredToolControllers(sessionId: string): void {
    const prefix = `${sessionId}:`
    for (const [key, controller] of this.runtimeSharedState.deferredToolAbortControllers) {
      if (!key.startsWith(prefix)) continue
      controller.abort()
      this.runtimeSharedState.deferredToolAbortControllers.delete(key)
    }
  }

  destroySession(sessionId: string): void {
    const controller =
      this.runtimeSharedState.activeGenerations.get(sessionId)?.abortController ??
      this.runtimeSharedState.abortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      this.runtimeSharedState.abortControllers.delete(sessionId)
    }
    this.abortDeferredToolControllers(sessionId)
    this.runtimeSharedState.activeGenerations.delete(sessionId)
    this.cancelProviderPermissions(sessionId)
  }

  private buildDeferredToolKey(sessionId: string, toolCallId: string): string {
    return `${sessionId}:${toolCallId}`
  }
}
