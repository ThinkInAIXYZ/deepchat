export type ChatSessionPerformancePhase =
  | 'selected'
  | 'preparation-started'
  | 'cache-committed'
  | 'messages-prepared'
  | 'messages-committed'
  | 'first-message-paint'
  | 'input-ready'
  | 'secondary-state-ready'

export function markChatSessionPerformance(
  phase: ChatSessionPerformancePhase,
  sessionId: string,
  sessionEpoch: number
): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return
  try {
    performance.mark(`deepchat:chat-session:${phase}`, {
      detail: { sessionId, sessionEpoch }
    })
  } catch {
    // Performance instrumentation must never affect chat readiness.
  }
}
