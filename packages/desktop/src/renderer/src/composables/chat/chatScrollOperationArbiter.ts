import { getChatScrollRequestPriority, type ChatScrollRequest } from './chatScrollState'

export type ChatScrollOfferResult = {
  accepted: boolean
  replacedRequestId: number | null
}

/**
 * Enforces exclusive ownership of the physical chat scrollbar.
 *
 * There is never more than one active operation. Repeated requests from the
 * same owner are coalesced. A higher-priority request replaces the active one
 * atomically; lower-priority work is discarded instead of being replayed later.
 */
export class ChatScrollOperationArbiter {
  private activeRequest: ChatScrollRequest | null = null
  private sessionEpoch: number | null = null

  get active(): ChatScrollRequest | null {
    return this.activeRequest
  }

  beginSession(sessionEpoch: number): void {
    this.sessionEpoch = sessionEpoch
    this.activeRequest = null
  }

  offer(request: ChatScrollRequest): ChatScrollOfferResult {
    if (this.sessionEpoch === null) {
      this.sessionEpoch = request.sessionEpoch
    }
    if (request.sessionEpoch !== this.sessionEpoch) {
      return { accepted: false, replacedRequestId: null }
    }

    const current = this.activeRequest
    if (!current) {
      this.activeRequest = request
      return { accepted: true, replacedRequestId: null }
    }

    if (current.reason === request.reason) {
      this.activeRequest = request
      return { accepted: true, replacedRequestId: null }
    }

    if (
      getChatScrollRequestPriority(request.reason) >= getChatScrollRequestPriority(current.reason)
    ) {
      this.activeRequest = request
      return { accepted: true, replacedRequestId: current.id }
    }

    return { accepted: false, replacedRequestId: null }
  }

  complete(requestId: number): boolean {
    if (this.activeRequest?.id !== requestId) return false
    this.activeRequest = null
    return true
  }

  cancelAll(): void {
    this.activeRequest = null
  }
}
