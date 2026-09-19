import { describe, expect, it, vi } from 'vitest'
import type { NotificationLifecycleEvent } from '@renderer-notifications/notificationManager'
import {
  SemanticNotificationController,
  type SemanticNotificationManagerPort
} from '@renderer-notifications/semanticNotificationController'
import type { NotificationRecovery } from '@renderer-notifications/notificationRequest'
import type { NotificationRequest } from '@renderer-notifications/notificationTypes'

const createHarness = () => {
  const notifications = {
    notify: vi.fn<
      (
        request: NotificationRequest,
        options?: {
          onLifecycleEvent?: (event: NotificationLifecycleEvent) => void
        }
      ) => unknown
    >(),
    recover: vi.fn<(recovery: NotificationRecovery) => void>()
  } satisfies SemanticNotificationManagerPort
  const acknowledgePresentation = vi.fn<(episodeId: string) => Promise<boolean>>(async () => true)
  const openSettings = vi.fn(async () => undefined)
  const translate = vi.fn((key: string, params?: Record<string, string>) =>
    params?.serverName
      ? `${key}:${params.serverName}`
      : params?.reason
        ? `${key}:${params.reason}`
        : key
  )
  const controller = new SemanticNotificationController({
    notifications,
    acknowledgePresentation,
    openSettings,
    translate
  })
  return {
    notifications,
    acknowledgePresentation,
    openSettings,
    translate,
    controller
  }
}

const lifecycleEvent = (
  reason: NotificationLifecycleEvent['reason']
): NotificationLifecycleEvent => ({
  logicalId: 'notification-1',
  reason,
  requests: []
})

describe('SemanticNotificationController', () => {
  it('translates MCP copy in the renderer without accepting a raw exception', () => {
    const { controller, notifications } = createHarness()

    controller.handle({
      kind: 'occur',
      episodeId: 'episode-1',
      intent: {
        code: 'mcp.connectionFailed',
        serverName: 'filesystem'
      }
    })

    expect(notifications.notify).toHaveBeenCalledWith(
      {
        kind: 'error',
        code: 'mcp.connectionFailed',
        key: 'filesystem',
        scope: 'mcp.connection',
        entity: 'filesystem',
        title: 'common.notifications.mcpConnectionFailed.title:filesystem',
        description: 'common.notifications.mcpConnectionFailed.description'
      },
      expect.objectContaining({
        onLifecycleEvent: expect.any(Function)
      })
    )
  })

  it('reuses one lifecycle listener for repeated occurrences of an episode', () => {
    const { controller, notifications } = createHarness()
    const delivery = {
      kind: 'occur' as const,
      episodeId: 'episode-1',
      intent: {
        code: 'mcp.toolListFailed' as const,
        serverName: 'filesystem'
      }
    }

    controller.handle(delivery)
    controller.handle(delivery)

    expect(notifications.notify).toHaveBeenCalledTimes(2)
    expect(notifications.notify.mock.calls[0][1]?.onLifecycleEvent).toBe(
      notifications.notify.mock.calls[1][1]?.onLifecycleEvent
    )
  })

  it.each([
    'unsupported-version',
    'invalid-payload',
    'provider-not-found',
    'unsupported-provider',
    'settings-unavailable'
  ] as const)('translates provider deeplink reason "%s" in the renderer', (reason) => {
    const { controller, notifications } = createHarness()

    controller.handle({
      kind: 'occur',
      episodeId: `episode-${reason}`,
      intent: {
        code: 'providerDeeplink.failed',
        reason
      }
    })

    expect(notifications.notify).toHaveBeenCalledWith(
      {
        kind: 'error',
        code: 'providerDeeplink.failed',
        key: reason,
        title: 'common.notifications.providerDeeplinkFailed.title',
        description: `common.notifications.providerDeeplinkFailed.reasons.${reason}`
      },
      expect.objectContaining({
        onLifecycleEvent: expect.any(Function)
      })
    )
  })

  it('recovers only the member associated with the exact episode', () => {
    const { controller, notifications } = createHarness()

    controller.handle({
      kind: 'occur',
      episodeId: 'episode-a',
      intent: {
        code: 'mcp.connectionFailed',
        serverName: 'filesystem'
      }
    })
    controller.handle({
      kind: 'occur',
      episodeId: 'episode-b',
      intent: {
        code: 'mcp.connectionFailed',
        serverName: 'database'
      }
    })
    controller.handle({ kind: 'recover', episodeId: 'episode-a' })

    expect(notifications.recover).toHaveBeenCalledOnce()
    expect(notifications.recover).toHaveBeenCalledWith({
      kind: 'transient',
      code: 'mcp.connectionFailed',
      key: 'filesystem',
      scope: 'mcp.connection'
    })
  })

  it('acknowledges a dismissed episode once but not a programmatic recovery', async () => {
    const { controller, notifications, acknowledgePresentation } = createHarness()
    const first = {
      kind: 'occur' as const,
      episodeId: 'episode-1',
      intent: {
        code: 'providerDeeplink.failed' as const,
        reason: 'invalid-payload' as const
      }
    }
    controller.handle(first)
    controller.handle(first)
    const firstLifecycle = notifications.notify.mock.calls[0][1]?.onLifecycleEvent

    firstLifecycle?.(lifecycleEvent('dismissed'))
    firstLifecycle?.(lifecycleEvent('dismissed'))
    await Promise.resolve()

    expect(acknowledgePresentation).toHaveBeenCalledOnce()
    expect(acknowledgePresentation).toHaveBeenCalledWith('episode-1')

    controller.handle({
      ...first,
      episodeId: 'episode-2'
    })
    notifications.notify.mock.calls[2][1]?.onLifecycleEvent?.(lifecycleEvent('programmatic'))
    await Promise.resolve()

    expect(acknowledgePresentation).toHaveBeenCalledOnce()
  })

  it('builds a typed database action without coupling the contract to a callback', async () => {
    const { controller, notifications, openSettings } = createHarness()

    controller.handle({
      kind: 'occur',
      episodeId: 'episode-1',
      intent: {
        code: 'databaseSecurity.repairSuggested',
        reason: 'missing-table',
        dedupeKey: 'chat-db'
      }
    })
    const request = notifications.notify.mock.calls[0][0]
    if (request.kind !== 'actionable') {
      throw new Error('Expected an actionable notification')
    }
    await request.action.onClick()

    expect(openSettings).toHaveBeenCalledWith({
      kind: 'open-settings',
      routeName: 'settings-database',
      section: 'database-repair'
    })
  })
})
