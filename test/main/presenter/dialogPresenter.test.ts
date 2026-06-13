import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEEPCHAT_EVENT_CHANNEL } from '../../../src/shared/contracts/channels'

const { sendToAllWindowsMock, sendToWebContentsMock } = vi.hoisted(() => ({
  sendToAllWindowsMock: vi.fn(),
  sendToWebContentsMock: vi.fn()
}))

import { DialogPresenter } from '../../../src/main/presenter/dialogPresenter'
import { setDeepchatEventWindowPresenter } from '../../../src/main/routes/publishDeepchatEvent'

describe('DialogPresenter', () => {
  beforeEach(() => {
    sendToAllWindowsMock.mockReset()
    sendToWebContentsMock.mockReset()
    setDeepchatEventWindowPresenter({
      sendToAllWindows: sendToAllWindowsMock,
      sendToWebContents: sendToWebContentsMock
    })
  })

  afterEach(() => {
    setDeepchatEventWindowPresenter(null)
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

    expect(sendToAllWindowsMock).toHaveBeenCalledTimes(1)
    expect(sendToAllWindowsMock).toHaveBeenCalledWith(
      DEEPCHAT_EVENT_CHANNEL,
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

    const envelope = sendToAllWindowsMock.mock.calls[0][1] as {
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
