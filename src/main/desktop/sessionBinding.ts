import type { SessionWithState } from '@shared/types/agent-interface'

export interface DesktopSessionProjectionPort {
  getSession(sessionId: string): Promise<SessionWithState | null>
  notify(input: {
    sessionIds: string[]
    reason: 'activated' | 'deactivated'
    activeSessionId: string | null
    webContentsId: number
  }): void
}

export class DesktopSessionBinding {
  private readonly bindings = new Map<number, string>()

  constructor(private readonly projection: DesktopSessionProjectionPort) {}

  bind(webContentsId: number, sessionId: string): void {
    this.bindings.set(webContentsId, sessionId)
  }

  unbind(webContentsId: number): void {
    this.bindings.delete(webContentsId)
  }

  getActiveId(webContentsId: number): string | null {
    return this.bindings.get(webContentsId) ?? null
  }

  getWebContentsIdsForSession(sessionId: string): number[] {
    return Array.from(this.bindings.entries()).flatMap(([webContentsId, boundSessionId]) =>
      boundSessionId === sessionId ? [webContentsId] : []
    )
  }

  async activate(webContentsId: number, sessionId: string): Promise<void> {
    this.bind(webContentsId, sessionId)
    this.projection.notify({
      sessionIds: [sessionId],
      reason: 'activated',
      activeSessionId: sessionId,
      webContentsId
    })
  }

  async deactivate(webContentsId: number): Promise<void> {
    this.unbind(webContentsId)
    this.projection.notify({
      sessionIds: [],
      reason: 'deactivated',
      activeSessionId: null,
      webContentsId
    })
  }

  async getActive(webContentsId: number): Promise<SessionWithState | null> {
    const sessionId = this.getActiveId(webContentsId)
    if (!sessionId) return null

    const session = await this.projection.getSession(sessionId)
    if (!session) this.unbind(webContentsId)
    return session
  }
}
