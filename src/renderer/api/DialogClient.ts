import type { DeepchatBridge } from '@shared/contracts/bridge'
import { dialogRequestedEvent } from '@shared/contracts/events'
import { dialogErrorRoute, dialogRespondRoute } from '@shared/contracts/routes'
import type { DialogResponse } from '@shared/presenter'
import { getDeepchatBridge } from './core'

export class DialogClient {
  constructor(private readonly bridge: DeepchatBridge = getDeepchatBridge()) {}

  async handleDialogResponse(response: DialogResponse) {
    await this.bridge.invoke(dialogRespondRoute.name, response)
  }

  async handleDialogError(id: string) {
    await this.bridge.invoke(dialogErrorRoute.name, { id })
  }

  onRequested(
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
    return this.bridge.on(dialogRequestedEvent.name, listener)
  }
}
