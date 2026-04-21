import type { DeepchatBridge } from '@shared/contracts/bridge'
import { dialogRequestedEvent } from '@shared/contracts/events'
import { dialogErrorRoute, dialogRespondRoute } from '@shared/contracts/routes'
import type { DialogResponse } from '@shared/presenter'
import { getDeepchatBridge } from './core'

export function createDialogClient(bridge: DeepchatBridge = getDeepchatBridge()) {
  async function handleDialogResponse(response: DialogResponse) {
    await bridge.invoke(dialogRespondRoute.name, response)
  }

  async function handleDialogError(id: string) {
    await bridge.invoke(dialogErrorRoute.name, { id })
  }

  function onRequested(
    listener: (payload: {
      id: string
      title: string
      description?: string
      i18n: boolean
      icon?: { icon: string; class: string }
      buttons: Array<{ key: string; label: string; default?: boolean }>
      timeout: number
      version: number
    }) => void
  ) {
    return bridge.on(dialogRequestedEvent.name, listener)
  }

  return {
    handleDialogResponse,
    handleDialogError,
    onRequested
  }
}

export type DialogClient = ReturnType<typeof createDialogClient>
