import { describe, expect, it, vi } from 'vitest'
import {
  EpisodeRegistry,
  resolveSemanticNotification,
  type ResolvedSemanticNotification,
  type SemanticNotificationDelivery,
  type SemanticNotificationIntent
} from '@shared/notifications'
import {
  WindowNotificationRouter,
  type NotificationWindowTarget,
  type WindowNotificationDiagnosticEvent,
  type WindowNotificationTargetPort
} from '@/notifications'
import { FakeNotificationTime } from '../../helpers/fakeNotificationTime'

class FakeWindowTargets implements WindowNotificationTargetPort {
  readonly deliveries: Array<{
    target: NotificationWindowTarget
    delivery: SemanticNotificationDelivery
  }> = []
  readonly failedWindowIds = new Set<number>()
  targets: NotificationWindowTarget[] = []
  activeWebContentsByWindow = new Map<number, number>()
  focusedWindowId?: number
  sendGate?: Promise<void>

  async getTargetForWindow(windowId: number): Promise<NotificationWindowTarget | undefined> {
    const activeWebContentsId = this.activeWebContentsByWindow.get(windowId)
    return this.targets.find(
      (target) =>
        target.windowId === windowId &&
        (activeWebContentsId === undefined || target.webContentsId === activeWebContentsId)
    )
  }

  async getTargetByWebContents(
    webContentsId: number
  ): Promise<NotificationWindowTarget | undefined> {
    return this.targets.find((target) => target.webContentsId === webContentsId)
  }

  async getFocusedTarget(): Promise<NotificationWindowTarget | undefined> {
    return this.focusedWindowId === undefined
      ? undefined
      : await this.getTargetForWindow(this.focusedWindowId)
  }

  async getExistingTargets(): Promise<readonly NotificationWindowTarget[]> {
    const windowIds = [...new Set(this.targets.map((target) => target.windowId))]
    const targets = await Promise.all(
      windowIds.map((windowId) => this.getTargetForWindow(windowId))
    )
    return targets.filter((target): target is NotificationWindowTarget => target !== undefined)
  }

  async send(
    target: NotificationWindowTarget,
    delivery: SemanticNotificationDelivery
  ): Promise<boolean> {
    await this.sendGate
    if (this.failedWindowIds.has(target.windowId)) return false
    this.deliveries.push({ target, delivery })
    return true
  }
}

const createRouter = (
  options: {
    targets?: FakeWindowTargets
    time?: FakeNotificationTime
    capacity?: number
    diagnostics?: (event: WindowNotificationDiagnosticEvent) => void
    resolveIntent?: (intent: SemanticNotificationIntent) => ResolvedSemanticNotification
  } = {}
) => {
  const time = options.time ?? new FakeNotificationTime()
  const targets = options.targets ?? new FakeWindowTargets()
  const episodes = new EpisodeRegistry(time, time)
  const diagnostics = vi.fn(options.diagnostics)
  const router = new WindowNotificationRouter({
    clock: time,
    scheduler: time,
    episodes,
    targets,
    diagnostics: { record: diagnostics },
    pendingActionableCapacity: options.capacity,
    resolveIntent: options.resolveIntent
  })
  return { time, targets, episodes, diagnostics, router }
}

describe('WindowNotificationRouter', () => {
  it('delivers once to the origin and keeps repeated occurrences on that renderer', async () => {
    const { router, targets } = createRouter()
    targets.targets = [
      { windowId: 1, webContentsId: 11, kind: 'main' },
      { windowId: 2, webContentsId: 22, kind: 'settings' }
    ]
    targets.focusedWindowId = 2

    const episodeId = await router.occur(
      {
        code: 'mcp.connectionFailed',
        serverName: 'filesystem'
      },
      { originWindowId: 1 }
    )
    targets.focusedWindowId = 2
    const repeatedEpisodeId = await router.occur({
      code: 'mcp.connectionFailed',
      serverName: 'filesystem'
    })

    expect(repeatedEpisodeId).toBe(episodeId)
    expect(targets.deliveries).toHaveLength(2)
    expect(targets.deliveries.map(({ target }) => target.windowId)).toEqual([1, 1])
    expect(targets.deliveries[0].delivery).toMatchObject({
      kind: 'occur',
      episodeId
    })
  })

  it('keeps an episode on its original renderer when the active tab changes', async () => {
    const { router, targets } = createRouter()
    targets.targets = [
      { windowId: 1, webContentsId: 11, kind: 'main' },
      { windowId: 1, webContentsId: 12, kind: 'main' }
    ]
    targets.activeWebContentsByWindow.set(1, 11)
    targets.focusedWindowId = 1

    const intent = {
      code: 'mcp.connectionFailed' as const,
      serverName: 'filesystem'
    }
    await router.occur(intent)
    targets.activeWebContentsByWindow.set(1, 12)
    await router.occur(intent)

    expect(targets.deliveries.map(({ target }) => target.webContentsId)).toEqual([11, 11])
  })

  it('falls through a failed preferred target without broadcasting', async () => {
    const { router, targets, diagnostics } = createRouter()
    targets.targets = [
      { windowId: 1, webContentsId: 11, kind: 'main' },
      { windowId: 2, webContentsId: 22, kind: 'settings' }
    ]
    targets.focusedWindowId = 2
    targets.failedWindowIds.add(2)

    await router.occur({
      code: 'providerDeeplink.failed',
      reason: 'invalid-payload'
    })

    expect(targets.deliveries).toHaveLength(1)
    expect(targets.deliveries[0].target.windowId).toBe(1)
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'providerDeeplink.failed',
        reason: 'delivery-failed'
      })
    )
  })

  it('recovers only the renderer that received the episode', async () => {
    const { router, targets } = createRouter()
    targets.targets = [
      { windowId: 1, webContentsId: 11, kind: 'main' },
      { windowId: 2, webContentsId: 22, kind: 'settings' }
    ]
    targets.focusedWindowId = 1

    const intent = {
      code: 'mcp.toolListFailed' as const,
      serverName: 'filesystem'
    }
    const episodeId = await router.occur(intent)
    targets.focusedWindowId = 2
    await router.recover(intent)
    await router.whenIdle()

    expect(targets.deliveries).toEqual([
      {
        target: { windowId: 1, webContentsId: 11, kind: 'main' },
        delivery: {
          kind: 'occur',
          episodeId,
          intent
        }
      },
      {
        target: { windowId: 1, webContentsId: 11, kind: 'main' },
        delivery: {
          kind: 'recover',
          episodeId
        }
      }
    ])
  })

  it('cancels pending actionable delivery when the problem recovers', async () => {
    const { router, targets, diagnostics } = createRouter()
    const intent = {
      code: 'databaseSecurity.repairSuggested' as const,
      reason: 'missing-table' as const,
      dedupeKey: 'chat-db'
    }

    await router.occur(intent)
    await router.recover(intent)
    targets.targets = [{ windowId: 2, webContentsId: 22, kind: 'settings' }]
    targets.focusedWindowId = 2
    await router.availabilityChanged()

    expect(targets.deliveries).toHaveLength(0)
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'databaseSecurity.repairSuggested',
        reason: 'pending-recovered'
      })
    )
  })

  it('delivers pending actionable records by priority and FIFO order', async () => {
    const { router, targets } = createRouter()

    const firstEpisodeId = await router.occur({
      code: 'databaseSecurity.repairSuggested',
      reason: 'missing-table',
      dedupeKey: 'first'
    })
    const secondEpisodeId = await router.occur({
      code: 'databaseSecurity.repairSuggested',
      reason: 'missing-column',
      dedupeKey: 'second'
    })

    targets.targets = [{ windowId: 2, webContentsId: 22, kind: 'settings' }]
    targets.focusedWindowId = 2
    await router.availabilityChanged()

    expect(targets.deliveries.map(({ delivery }) => delivery)).toEqual([
      expect.objectContaining({ kind: 'occur', episodeId: firstEpisodeId }),
      expect.objectContaining({ kind: 'occur', episodeId: secondEpisodeId })
    ])
  })

  it('keeps the older equal-priority actionable when pending capacity overflows', async () => {
    const { router, targets, diagnostics, episodes } = createRouter({ capacity: 1 })

    const retainedEpisodeId = await router.occur({
      code: 'databaseSecurity.repairSuggested',
      reason: 'missing-table',
      dedupeKey: 'first'
    })
    const droppedEpisodeId = await router.occur({
      code: 'databaseSecurity.repairSuggested',
      reason: 'missing-column',
      dedupeKey: 'second'
    })

    expect(episodes.get('["databaseSecurity.repairSuggested","second"]')?.suppressed).toBe(true)
    targets.targets = [{ windowId: 1, webContentsId: 11, kind: 'main' }]
    await router.availabilityChanged()

    expect(targets.deliveries).toHaveLength(1)
    expect(targets.deliveries[0].delivery).toMatchObject({
      kind: 'occur',
      episodeId: retainedEpisodeId
    })
    expect(targets.deliveries[0].delivery).not.toMatchObject({ episodeId: droppedEpisodeId })
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'actionable-overflow'
      })
    )
  })

  it('does not extend a pending deadline when the same episode repeats', async () => {
    const time = new FakeNotificationTime()
    const { router, targets, diagnostics } = createRouter({
      time,
      resolveIntent: (intent) => {
        const resolved = resolveSemanticNotification(intent)
        return intent.code === 'databaseSecurity.repairSuggested'
          ? {
              ...resolved,
              routing: {
                ...resolved.routing,
                pendingTtlMs: 100
              }
            }
          : resolved
      }
    })
    const intent = {
      code: 'databaseSecurity.repairSuggested' as const,
      reason: 'missing-table' as const,
      dedupeKey: 'chat-db'
    }

    await router.occur(intent)
    time.advanceBy(60)
    await router.occur(intent)
    time.advanceBy(40)
    await router.whenIdle()
    targets.targets = [{ windowId: 1, webContentsId: 11, kind: 'main' }]
    await router.availabilityChanged()

    expect(targets.deliveries).toHaveLength(0)
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'pending-expired'
      })
    )
  })

  it('moves an active actionable back to pending when its renderer disappears', async () => {
    const { router, targets } = createRouter()
    targets.targets = [{ windowId: 2, webContentsId: 22, kind: 'settings' }]
    targets.focusedWindowId = 2

    const episodeId = await router.occur({
      code: 'databaseSecurity.repairSuggested',
      reason: 'type-mismatch',
      dedupeKey: 'agent-db'
    })
    targets.targets = []
    targets.focusedWindowId = undefined
    await router.availabilityChanged()
    targets.targets = [{ windowId: 1, webContentsId: 11, kind: 'main' }]
    targets.focusedWindowId = 1
    await router.availabilityChanged()

    expect(targets.deliveries).toHaveLength(2)
    expect(targets.deliveries.map(({ target }) => target.windowId)).toEqual([2, 1])
    expect(targets.deliveries[1].delivery).toMatchObject({ episodeId })
  })

  it('does not trust a renderer that became ready again before invalidation is reconciled', async () => {
    const { router, targets } = createRouter()
    targets.targets = [{ windowId: 2, webContentsId: 22, kind: 'settings' }]
    targets.focusedWindowId = 2

    const episodeId = await router.occur({
      code: 'databaseSecurity.repairSuggested',
      reason: 'type-mismatch',
      dedupeKey: 'agent-db'
    })
    await router.availabilityChanged({
      unavailableWebContentsIds: [22]
    })

    expect(targets.deliveries).toHaveLength(1)

    targets.targets = [{ windowId: 1, webContentsId: 11, kind: 'main' }]
    targets.focusedWindowId = 1
    await router.availabilityChanged()

    expect(targets.deliveries).toHaveLength(2)
    expect(targets.deliveries[1]).toMatchObject({
      target: { webContentsId: 11 },
      delivery: { episodeId }
    })
  })

  it('accepts presentation suppression only from the renderer that received it', async () => {
    const { router, targets, episodes } = createRouter()
    targets.targets = [
      { windowId: 1, webContentsId: 11, kind: 'main' },
      { windowId: 2, webContentsId: 22, kind: 'settings' }
    ]
    targets.focusedWindowId = 1
    const intent = {
      code: 'mcp.connectionFailed' as const,
      serverName: 'filesystem'
    }

    const episodeId = await router.occur(intent)
    await expect(
      router.acknowledgePresentation(episodeId, {
        webContentsId: 22
      })
    ).resolves.toBe(false)
    await expect(
      router.acknowledgePresentation(episodeId, {
        webContentsId: 11
      })
    ).resolves.toBe(true)
    await router.occur(intent)

    expect(episodes.get('["mcp.connectionFailed","filesystem"]')?.suppressed).toBe(true)
    expect(targets.deliveries).toHaveLength(1)
  })

  it('serializes recovery behind an in-flight occurrence delivery', async () => {
    const { router, targets } = createRouter()
    targets.targets = [{ windowId: 1, webContentsId: 11, kind: 'main' }]
    let releaseSend = () => undefined
    targets.sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve
    })
    const intent = {
      code: 'mcp.connectionFailed' as const,
      serverName: 'filesystem'
    }

    const occurrence = router.occur(intent)
    const recovery = router.recover(intent)
    releaseSend()
    const episodeId = await occurrence
    await recovery
    await router.whenIdle()

    expect(targets.deliveries.map(({ delivery }) => delivery)).toEqual([
      {
        kind: 'occur',
        episodeId,
        intent
      },
      {
        kind: 'recover',
        episodeId
      }
    ])
  })

  it('drops unavailable transient records instead of replaying stale feedback later', async () => {
    const { router, targets, diagnostics } = createRouter()

    await router.occur({
      code: 'providerDeeplink.failed',
      reason: 'settings-unavailable'
    })
    targets.targets = [{ windowId: 2, webContentsId: 22, kind: 'settings' }]
    targets.focusedWindowId = 2
    await router.availabilityChanged()

    expect(targets.deliveries).toHaveLength(0)
    expect(diagnostics).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'providerDeeplink.failed',
        reason: 'no-compatible-target'
      })
    )
  })
})
