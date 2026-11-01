import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dialog } from 'electron'
import { CORE_NATIVE_CALLS } from '@shared/harness/core'

const publishEventMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() }
}))

import { DialogService } from '@/desktop/dialog'

describe('DialogService', () => {
  beforeEach(() => {
    publishEventMock.mockReset()
    vi.mocked(dialog.showOpenDialog).mockReset()
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

  it('rejects pending confirmations and refuses new dialogs after shutdown', async () => {
    const presenter = new DialogService(publishEventMock)
    const pending = presenter.showDialog({ title: 'Confirm shutdown' })
    const rejected = expect(pending).rejects.toThrow('Dialog service is stopping')
    const { id } = publishEventMock.mock.calls[0][1] as { id: string }

    presenter.destroy()
    await rejected
    await presenter.handleDialogResponse({ id, button: 'confirm' })
    await expect(presenter.showDialog({ title: 'Late confirmation' })).rejects.toThrow(
      'Dialog service is stopping'
    )
    expect(publishEventMock).toHaveBeenCalledOnce()
  })

  it('queues bounded native pickers and waits for physical closure before retiring', async () => {
    const presenter = new DialogService(publishEventMock)
    const parent = { isDestroyed: () => false, hide() {} } as Electron.BrowserWindow
    const first = Promise.withResolvers<Electron.OpenDialogReturnValue>()
    const held = Promise.withResolvers<Electron.OpenDialogReturnValue>()
    vi.mocked(dialog.showOpenDialog)
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/chosen'] })
      .mockReturnValueOnce(held.promise)
    const initial = presenter.showOpenDialog(parent, {})
    const queued = presenter.showOpenDialog(parent, {})
    await vi.waitFor(() => expect(dialog.showOpenDialog).toHaveBeenCalledOnce())
    first.resolve({ canceled: true, filePaths: [] })
    await expect(initial).resolves.toEqual({ canceled: true, filePaths: [] })
    await expect(queued).resolves.toEqual({ canceled: false, filePaths: ['/chosen'] })

    const accepted = Array.from({ length: CORE_NATIVE_CALLS }, () =>
      presenter.showOpenDialog(parent, {}).then(
        (result) => result,
        () => null
      )
    )
    await vi.waitFor(() => expect(dialog.showOpenDialog).toHaveBeenCalledTimes(3))
    await expect(presenter.showOpenDialog(parent, {})).rejects.toThrow(
      'Native dialog limit exceeded'
    )
    presenter.destroy()
    let retired = false
    const closing = presenter.drainNativeDialogs().then(() => {
      retired = true
    })
    await Promise.resolve()
    expect(retired).toBe(false)
    held.resolve({ canceled: true, filePaths: [] })
    await closing
    expect(await Promise.all(accepted)).toEqual([
      { canceled: true, filePaths: [] },
      ...Array(CORE_NATIVE_CALLS - 1).fill(null)
    ])
    expect(dialog.showOpenDialog).toHaveBeenCalledTimes(3)
  })
})
