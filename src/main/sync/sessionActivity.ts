export class SyncSessionActivity {
  private readonly activeSessions = new Set<string>()

  constructor(private readonly wake: () => void) {}

  get size(): number {
    return this.activeSessions.size
  }

  has(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  update(sessionId: string, status: string): void {
    if (status === 'generating' || status === 'running') {
      this.activeSessions.add(sessionId)
    } else {
      this.activeSessions.delete(sessionId)
      this.wake()
    }
  }
}
