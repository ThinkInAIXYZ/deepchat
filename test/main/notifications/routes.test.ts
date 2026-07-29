import { describe, expect, it, vi } from 'vitest'
import {
  notificationAcknowledgePresentationRoute,
  notificationRendererReadyRoute
} from '@shared/contracts/routes'
import { createNotificationRoutes } from '@/notifications/routes'

describe('notification routes', () => {
  it('binds renderer readiness to the invoking WebContents', async () => {
    const rendererReady = vi.fn(async () => true)
    const routes = createNotificationRoutes({
      rendererReady,
      acknowledgePresentation: vi.fn()
    })

    await expect(
      routes.get(notificationRendererReadyRoute.name)?.({}, { webContentsId: 42, windowId: 7 })
    ).resolves.toEqual({ ready: true })
    expect(rendererReady).toHaveBeenCalledWith(42)
  })

  it('binds presentation acknowledgement to the invoking WebContents', async () => {
    const acknowledgePresentation = vi.fn(async () => true)
    const routes = createNotificationRoutes({
      rendererReady: vi.fn(),
      acknowledgePresentation
    })

    await expect(
      routes.get(notificationAcknowledgePresentationRoute.name)?.(
        { episodeId: 'episode-1' },
        { webContentsId: 42, windowId: 7 }
      )
    ).resolves.toEqual({ accepted: true })
    expect(acknowledgePresentation).toHaveBeenCalledWith('episode-1', 42)
  })

  it('rejects malformed acknowledgement identities at the route boundary', async () => {
    const acknowledgePresentation = vi.fn()
    const routes = createNotificationRoutes({
      rendererReady: vi.fn(),
      acknowledgePresentation
    })

    await expect(
      routes.get(notificationAcknowledgePresentationRoute.name)?.(
        { episodeId: '' },
        { webContentsId: 42, windowId: 7 }
      )
    ).rejects.toThrow()
    expect(acknowledgePresentation).not.toHaveBeenCalled()
  })
})
