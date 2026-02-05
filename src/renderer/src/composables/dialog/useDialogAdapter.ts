import { usePresenter } from '@/composables/usePresenter'
import { DIALOG_EVENTS } from '@/events'
import type { DialogRequest, DialogResponse } from '@shared/presenter'

type Unsubscribe = () => void

const noopUnsubscribe: Unsubscribe = () => undefined

export type DialogAdapter = {
  handleDialogResponse: (response: DialogResponse) => Promise<void>
  handleDialogError: (id: string) => Promise<void>
  onRequest: (handler: (request: DialogRequest) => void) => Unsubscribe
}

export function useDialogAdapter(): DialogAdapter {
  const dialogPresenter = usePresenter('dialogPresenter')

  const subscribe = <T>(event: string, handler: (payload: T) => void): Unsubscribe => {
    if (!window?.electron?.ipcRenderer) return noopUnsubscribe

    const listener = (_event: unknown, payload: T) => {
      handler(payload)
    }

    window.electron.ipcRenderer.on(event, listener)

    return () => {
      window.electron.ipcRenderer.removeListener(event, listener)
    }
  }

  return {
    handleDialogResponse: (response: DialogResponse) =>
      dialogPresenter.handleDialogResponse(response),
    handleDialogError: (id: string) => dialogPresenter.handleDialogError(id),
    onRequest: (handler) => subscribe<DialogRequest>(DIALOG_EVENTS.REQUEST, handler)
  }
}
