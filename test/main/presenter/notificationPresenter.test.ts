import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishDeepchatEventMock = vi.hoisted(() => vi.fn())
const getNotificationsEnabledMock = vi.hoisted(() => vi.fn(() => true))

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
  nativeImage: {
    createFromPath: vi.fn(() => ({ isMockIcon: true }))
  },
  Notification: notificationState.MockNotification
}))

vi.mock('@/presenter', () => ({
  presenter: {
    configPresenter: {
      getNotificationsEnabled: getNotificationsEnabledMock
    }
  }
}))

vi.mock('@/routes/publishDeepchatEvent', () => ({
  publishDeepchatEvent: publishDeepchatEventMock
}))

describe('NotificationPresenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    notificationState.instances.length = 0
    getNotificationsEnabledMock.mockReturnValue(true)
  })

  it('publishes a typed app runtime event when a system notification is clicked', async () => {
    const { NotificationPresenter } = await import('@/presenter/notificationPresenter')
    const presenter = new NotificationPresenter()

    await presenter.showNotification({
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
    const { NotificationPresenter } = await import('@/presenter/notificationPresenter')
    const presenter = new NotificationPresenter()

    await presenter.showNotification({
      id: 'session-123',
      title: 'Finished',
      body: 'The background task is done'
    })

    expect(notificationState.instances).toHaveLength(0)
    expect(publishDeepchatEventMock).not.toHaveBeenCalled()
  })
})
