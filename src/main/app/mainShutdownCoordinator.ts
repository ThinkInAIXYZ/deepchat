import type { MainLogShutdownReason } from '@/logging/mainLogEvents'
import { elapsedMonotonicMs, readMonotonicNow, type MonotonicClock } from '@/lib/monotonicTime'

export interface MainShutdownTerminalObservation {
  outcome: 'completed' | 'failed'
  durationMs?: number
}

export interface MainShutdownActionFailureObservation {
  reason: MainLogShutdownReason
  durationMs?: number
  error: unknown
}

export interface MainShutdownObserver {
  started(reason: MainLogShutdownReason): void
  terminal(observation: MainShutdownTerminalObservation): void
  actionFailed?(observation: MainShutdownActionFailureObservation): void
}

export interface MainShutdownActionClaim {
  run(action: () => void | Promise<void>): Promise<void>
  abandon(): void
}

export type MainShutdownTeardownOutcome = 'completed' | 'failed'

export class MainShutdownCoordinator {
  private teardownPromise: Promise<MainShutdownTeardownOutcome | void> | undefined
  private actionClaim: symbol | undefined

  constructor(
    private readonly teardown: () => Promise<MainShutdownTeardownOutcome | void>,
    private readonly observer: MainShutdownObserver,
    private readonly now?: MonotonicClock
  ) {}

  async cleanup(): Promise<void> {
    await this.ensureTeardown()
  }

  async request(reason: MainLogShutdownReason): Promise<MainShutdownActionClaim | undefined> {
    if (this.actionClaim) {
      await this.ensureTeardown()
      return undefined
    }

    const actionClaim = Symbol(reason)
    this.actionClaim = actionClaim
    const startedAt = readMonotonicNow(this.now)
    this.observe(() => this.observer.started(reason))
    try {
      const teardownOutcome = (await this.ensureTeardown()) ?? 'completed'
      const durationMs = elapsedMonotonicMs(startedAt, this.now)
      this.observe(() =>
        this.observer.terminal({
          outcome: teardownOutcome,
          ...(durationMs === undefined ? {} : { durationMs })
        })
      )
      let state: 'ready' | 'running' | 'succeeded' | 'released' = 'ready'
      const abandon = () => {
        if (state !== 'ready') return
        state = 'released'
        if (this.actionClaim === actionClaim) this.actionClaim = undefined
      }
      return {
        run: async (action) => {
          if (state !== 'ready' || this.actionClaim !== actionClaim) {
            throw new Error('Main shutdown action claim is not active')
          }
          state = 'running'
          try {
            await action()
            state = 'succeeded'
          } catch (error) {
            state = 'released'
            if (this.actionClaim === actionClaim) this.actionClaim = undefined
            const durationMs = elapsedMonotonicMs(startedAt, this.now)
            this.observe(() =>
              this.observer.actionFailed?.({
                reason,
                ...(durationMs === undefined ? {} : { durationMs }),
                error
              })
            )
            throw error
          }
        },
        abandon
      }
    } catch (error) {
      if (this.actionClaim === actionClaim) this.actionClaim = undefined
      const durationMs = elapsedMonotonicMs(startedAt, this.now)
      this.observe(() =>
        this.observer.terminal({
          outcome: 'failed',
          ...(durationMs === undefined ? {} : { durationMs })
        })
      )
      throw error
    }
  }

  private ensureTeardown(): Promise<MainShutdownTeardownOutcome | void> {
    if (!this.teardownPromise) {
      try {
        this.teardownPromise = this.teardown()
      } catch (error) {
        this.teardownPromise = Promise.reject(error)
      }
    }
    return this.teardownPromise
  }

  private observe(callback: () => void): void {
    try {
      callback()
    } catch {
      // Diagnostics must not affect teardown or terminal-action ownership.
    }
  }
}
