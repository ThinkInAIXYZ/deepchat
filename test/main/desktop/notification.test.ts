import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const getNotificationsEnabledMock = vi.hoisted(() => vi.fn(() => true))
const getAllWindowsMock = vi.hoisted(() => vi.fn(() => [] as unknown[]))

const notificationState = vi.hoisted(() => {
  class MockNotification {
    options: unknown
    handlers = new Map<string, () => void>()
    show = vi.fn()

    constructor(options: unknown) {
      this.options = options
      notificationState.instances.push(this)
    }

    on(eventName: string, handler: () => void) {
      this.handlers.set(eventName, handler)
      return this
    }
  }

  return {
    instances: [] as MockNotification[],
    MockNotification
  }
})

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: getAllWindowsMock },
  nativeImage: {
    createFromPath: vi.fn(() => ({ isMockIcon: true }))
  },
  Notification: notificationState.MockNotification
}))

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notificationState.instances.length = 0
    getNotificationsEnabledMock.mockReturnValue(true)
    getAllWindowsMock.mockReturnValue([])
  })

  it('publishes a typed app runtime event when a system notification is clicked', async () => {
    const { NotificationService } = await import('@/desktop/notification')
    const service = new NotificationService(
      {
        getNotificationsEnabled: getNotificationsEnabledMock,
        getLanguage: () => 'en-US'
      },
      publishDeepchatEventMock
    )

    await service.showNotification({
      id: 'session-123',
      title: 'Finished',
      body: 'The background task is done'
    })

    expect(notificationState.instances).toHaveLength(1)
    expect(notificationState.instances[0].show).toHaveBeenCalledTimes(1)

    notificationState.instances[0].handlers.get('click')?.()

    expect(publishDeepchatEventMock).toHaveBeenCalledTimes(1)
    expect(publishDeepchatEventMock).toHaveBeenCalledWith('appRuntime.systemNotificationClicked', {
      payload: 'session-123'
    })
  })

  it('does not create a system notification when notifications are disabled', async () => {
    getNotificationsEnabledMock.mockReturnValue(false)
    const { NotificationService } = await import('@/desktop/notification')
    const service = new NotificationService(
      {
        getNotificationsEnabled: getNotificationsEnabledMock,
        getLanguage: () => 'en-US'
      },
      publishDeepchatEventMock
    )

    await service.showNotification({
      id: 'session-123',
      title: 'Finished',
      body: 'The background task is done'
    })

    expect(notificationState.instances).toHaveLength(0)
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })

  it.each([
    { state: 'unfocused but visible', focused: false, visible: true, minimized: false, count: 1 },
    { state: 'minimized', focused: false, visible: true, minimized: true, count: 1 },
    { state: 'hidden', focused: false, visible: false, minimized: false, count: 1 },
    { state: 'foreground', focused: true, visible: true, minimized: false, count: 0 }
  ])(
    'sends completion notifications when $state',
    async ({ focused, visible, minimized, count }) => {
      const { NotificationService } = await import('@/desktop/notification')
      getAllWindowsMock.mockReturnValue([
        {
          isDestroyed: () => false,
          isFocused: () => focused,
          isVisible: () => visible,
          isMinimized: () => minimized
        }
      ])
      const service = new NotificationService(
        { getNotificationsEnabled: getNotificationsEnabledMock, getLanguage: () => 'zh-CN' },
        publishDeepchatEventMock
      )

      await service.showSessionCompletion({ id: 'session-123', title: 'Release notes' })

      expect(notificationState.instances).toHaveLength(count)
      if (count) {
        expect(notificationState.instances[0].options).toMatchObject({
          title: '生成完毕',
          body: 'Release notes'
        })
        expect(notificationState.instances[0].show).toHaveBeenCalledOnce()
        notificationState.instances[0].handlers.get('click')?.()
        expect(publishDeepchatEventMock).toHaveBeenCalledWith(
          'appRuntime.systemNotificationClicked',
          {
            payload: 'chat/session-123/completed'
          }
        )
      }

      getNotificationsEnabledMock.mockReturnValue(false)
      await service.showSessionCompletion({ id: 'other-session', title: 'Disabled' })
      expect(notificationState.instances).toHaveLength(count)
    }
  )
})
