import type { MainLogShutdownReason } from '@/logging/mainLogEvents'

export interface MainShutdownTerminalObservation {
  outcome: 'completed' | 'failed'
  durationMs: number
}

export interface MainShutdownObserver {
  started(reason: MainLogShutdownReason): void
  terminal(observation: MainShutdownTerminalObservation): void
}

export class MainShutdownCoordinator {
  private teardownPromise: Promise<void> | undefined
  private actionClaimed = false

  constructor(
    private readonly teardown: () => Promise<void>,
    private readonly observer: MainShutdownObserver,
    private readonly now: () => number = performance.now.bind(performance)
  ) {}

  cleanup(): Promise<void> {
    return this.ensureTeardown()
  }

  async request(reason: MainLogShutdownReason): Promise<boolean> {
    if (this.actionClaimed) {
      await this.ensureTeardown()
      return false
    }

    this.actionClaimed = true
    const startedAt = this.now()
    this.observe(() => this.observer.started(reason))
    try {
      await this.ensureTeardown()
      this.observe(() =>
        this.observer.terminal({ outcome: 'completed', durationMs: this.now() - startedAt })
      )
      return true
    } catch (error) {
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
