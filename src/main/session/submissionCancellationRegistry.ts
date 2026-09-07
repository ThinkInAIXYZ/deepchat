export interface SubmissionCancellationRegistration {
  signal: AbortSignal
  unregister(): void
}

const MAX_ACTIVE_SUBMISSIONS_PER_OWNER = 32

/**
 * Owns renderer-scoped cancellation for attachment acceptance. Submission IDs are intentionally
 * namespaced by webContents so one renderer cannot cancel another renderer's work.
 */
export class SubmissionCancellationRegistry {
  private readonly controllersByOwner = new Map<number, Map<string, AbortController>>()

  register(webContentsId: number, submissionId: string): SubmissionCancellationRegistration {
    const ownerControllers = this.controllersByOwner.get(webContentsId) ?? new Map()
    if (ownerControllers.has(submissionId)) {
      throw new Error(`Submission is already active: ${submissionId}`)
    }
    if (ownerControllers.size >= MAX_ACTIVE_SUBMISSIONS_PER_OWNER) {
      throw new Error(`Too many active submissions for renderer ${webContentsId}`)
    }

    const controller = new AbortController()
    ownerControllers.set(submissionId, controller)
    this.controllersByOwner.set(webContentsId, ownerControllers)

    let registered = true
    return {
      signal: controller.signal,
      unregister: () => {
        if (!registered) return
        registered = false
        this.unregister(webContentsId, submissionId, controller)
      }
    }
  }

  cancel(webContentsId: number, submissionId: string): boolean {
    const controller = this.controllersByOwner.get(webContentsId)?.get(submissionId)
    if (!controller) return false
    controller.abort()
    return true
  }

  private unregister(
    webContentsId: number,
    submissionId: string,
    controller: AbortController
  ): void {
    const ownerControllers = this.controllersByOwner.get(webContentsId)
    if (ownerControllers?.get(submissionId) !== controller) return
    ownerControllers.delete(submissionId)
    if (ownerControllers.size === 0) {
      this.controllersByOwner.delete(webContentsId)
    }
  }
}
