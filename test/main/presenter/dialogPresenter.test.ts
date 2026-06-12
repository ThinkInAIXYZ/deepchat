import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'

const { sendToRendererMock } = vi.hoisted(() => ({
  sendToRendererMock: vi.fn()
}))

vi.mock('@/eventbus', () => ({
  eventBus: {
    sendToRenderer: sendToRendererMock
  },
  SendTarget: {
    ALL_WINDOWS: 'all_windows',
    DEFAULT_WINDOW: 'default_window'
  }
}))

import { DialogPresenter } from '../../../src/main/presenter/dialogPresenter'

describe('DialogPresenter', () => {
  beforeEach(() => {
    sendToRendererMock.mockReset()
  })

  it('publishes dialog requests through the typed deepchat event channel only', async () => {
    const presenter = new DialogPresenter()
    const responsePromise = presenter.showDialog({
      title: 'Confirm action',
      description: 'Proceed?',
      buttons: [
        { key: 'cancel', label: 'Cancel' },
        { key: 'ok', label: 'OK', default: true }
      ],
      timeout: 1000
    })

    expect(sendToRendererMock).toHaveBeenCalledTimes(1)
    expect(sendToRendererMock).toHaveBeenCalledWith(
      DEEPCHAT_EVENT_CHANNEL,
      'all_windows',
      expect.objectContaining({
        name: 'dialog.requested',
        payload: expect.objectContaining({
          title: 'Confirm action',
          description: 'Proceed?',
          i18n: false,
          timeout: 1000,
          version: expect.any(Number)
        })
      })
    )

    const envelope = sendToRendererMock.mock.calls[0][2] as {
      payload: {
        id: string
      }
    }
    await presenter.handleDialogResponse({
      id: envelope.payload.id,
      button: 'ok'
    })

    await expect(responsePromise).resolves.toBe('ok')
  })
})
