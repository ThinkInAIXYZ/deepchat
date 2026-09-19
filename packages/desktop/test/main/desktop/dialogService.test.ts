import { beforeEach, describe, expect, it, vi } from 'vitest'

const publishEventMock = vi.hoisted(() => vi.fn())

import { DialogService } from '@/desktop/dialog'

describe('DialogService', () => {
  beforeEach(() => {
    publishEventMock.mockReset()
  })

  it('publishes dialog requests through the typed deepchat event channel only', async () => {
    const presenter = new DialogService(publishEventMock)
    const responsePromise = presenter.showDialog({
      title: 'Confirm action',
      description: 'Proceed?',
      buttons: [
        { key: 'cancel', label: 'Cancel' },
        { key: 'ok', label: 'OK', default: true }
      ],
      timeout: 1000
    })

    expect(publishEventMock).toHaveBeenCalledTimes(1)
    expect(publishEventMock).toHaveBeenCalledWith(
      'dialog.requested',
      expect.objectContaining({
        title: 'Confirm action',
        description: 'Proceed?',
        i18n: false,
        timeout: 1000,
        version: expect.any(Number)
      })
    )

    const payload = publishEventMock.mock.calls[0][1] as { id: string }
    await presenter.handleDialogResponse({
      id: payload.id,
      button: 'ok'
    })

    await expect(responsePromise).resolves.toBe('ok')
  })
})
