import type { MainLogShutdownReason } from '@/logging/mainLogEvents'

export interface MainShutdownTerminalObservation {
  outcome: 'completed' | 'failed'
  durationMs: number
}

export interface MainShutdownObserver {
  started(reason: MainLogShutdownReason): void
  terminal(observation: MainShutdownTerminalObservation): void
}

export interface MainShutdownActionClaim {
  run(action: () => void | Promise<void>): Promise<void>
  abandon(): void
}

export class MainShutdownCoordinator {
  private teardownPromise: Promise<void> | undefined
  private actionClaim: symbol | undefined

  constructor(
    private readonly teardown: () => Promise<void>,
    private readonly observer: MainShutdownObserver,
    private readonly now: () => number = performance.now.bind(performance)
  ) {}

  cleanup(): Promise<void> {
    return this.ensureTeardown()
  }

  async request(reason: MainLogShutdownReason): Promise<MainShutdownActionClaim | undefined> {
    if (this.actionClaim) {
      await this.ensureTeardown()
      return undefined
    }

    const actionClaim = Symbol(reason)
    this.actionClaim = actionClaim
    const startedAt = this.now()
    this.observe(() => this.observer.started(reason))
    try {
      await this.ensureTeardown()
      this.observe(() =>
        this.observer.terminal({ outcome: 'completed', durationMs: this.now() - startedAt })
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
            throw error
          }
        },
        abandon
      }
    } catch (error) {
      if (this.actionClaim === actionClaim) this.actionClaim = undefined
      this.observe(() =>
        this.observer.terminal({ outcome: 'failed', durationMs: this.now() - startedAt })
      )
      throw error
    }
  }

  private ensureTeardown(): Promise<void> {
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
