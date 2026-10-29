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
  private readonly watches = new Map<number, { dispose(): void }>()

  constructor(
    private readonly projection: DesktopSessionProjectionPort,
    private readonly onRendererDestroyed: (
      webContentsId: number,
      listener: () => void
    ) => () => void
  ) {}

  bind(webContentsId: number, sessionId: string): void {
    this.bindings.set(webContentsId, sessionId)
    if (this.watches.has(webContentsId)) return
    const watch = { dispose() {} }
    this.watches.set(webContentsId, watch)
    try {
      watch.dispose = this.onRendererDestroyed(webContentsId, () => this.unbind(webContentsId))
      if (this.watches.get(webContentsId) !== watch) watch.dispose()
    } catch (error) {
      this.unbind(webContentsId)
      throw error
    }
  }

  unbind(webContentsId: number): void {
    this.bindings.delete(webContentsId)
    const watch = this.watches.get(webContentsId)
    this.watches.delete(webContentsId)
    watch?.dispose()
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
    if (this.getActiveId(webContentsId) !== sessionId) return
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
    if (this.getActiveId(webContentsId) !== sessionId) return null
    if (!session) this.unbind(webContentsId)
    return session
  }
}
