import { getChatScrollRequestPriority, type ChatScrollRequest } from './chatScrollState'

export class ChatScrollRequestQueue {
  private pendingRequest: ChatScrollRequest | null = null

  enqueue(request: ChatScrollRequest): void {
    // The arbiter has already selected the exclusive owner. Keeping older
    // accepted requests would let stale work replay after the owner changes.
    const pending = this.pendingRequest
    if (
      !pending ||
      request.sessionEpoch > pending.sessionEpoch ||
      (request.sessionEpoch === pending.sessionEpoch &&
        getChatScrollRequestPriority(request.reason) >=
          getChatScrollRequestPriority(pending.reason))
    ) {
      this.pendingRequest = request
    }
  }

  cancel(requestId: number): void {
    if (this.pendingRequest?.id === requestId) {
      this.pendingRequest = null
    }
  }

  clear(): void {
    this.pendingRequest = null
  }

  take(sessionEpoch: number): ChatScrollRequest | null {
    const request = this.pendingRequest
    if (!request) return null
    if (request.sessionEpoch > sessionEpoch) return null
    this.pendingRequest = null
    return request.sessionEpoch === sessionEpoch ? request : null
  }
}
