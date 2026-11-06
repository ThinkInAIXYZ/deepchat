import { EventEmitter } from 'node:events'

/**
 * Coordinates transport shutdown with the real Main before-quit listener.
 * Exit is allowed only after that listener finishes teardown and app.quit()
 * confirms it. Concurrent closes share one shutdown attempt.
 */
export class SidecarLifecycle {
  private readonly events = new EventEmitter()
  private stopping = false
  private quitApproved = false
  private shutdownPromise: Promise<void> | undefined

  constructor(private readonly beforeQuit: () => boolean) {}

  isStopping(): boolean {
    return this.stopping || this.quitApproved
  }

  notifyQuitRequested(): void {
    this.quitApproved = true
    this.stopping = true
    this.events.emit('quit')
  }

  shutdown(): Promise<void> {
    if (this.quitApproved) return Promise.resolve()
    if (this.shutdownPromise) return this.shutdownPromise

    this.stopping = true
    let resolveShutdown!: () => void
    let rejectShutdown!: (error: unknown) => void
    const completion = new Promise<void>((resolve, reject) => {
      resolveShutdown = resolve
      rejectShutdown = reject
    })
    this.shutdownPromise = completion
    this.events.once('quit', resolveShutdown)

    let proceed: boolean
    try {
      proceed = this.beforeQuit()
    } catch (error) {
      if (this.shutdownPromise === completion) {
        this.shutdownPromise = undefined
        this.stopping = false
      }
      this.events.removeListener('quit', resolveShutdown)
      rejectShutdown(error)
      return completion
    }

    if (proceed) {
      this.quitApproved = true
      resolveShutdown()
    }
    return completion
  }
}
